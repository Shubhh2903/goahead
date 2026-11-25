import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

import { developmentChildEnvironment } from "./development-environment";

const logger = createOpenBotLogger("dev-slack");

const SLACK_FILE = ".env.slack-dev";
const SLACK_KEYS = [
  "OPENBOT_DEV_SLACK_SIGNING_SECRET",
  "OPENBOT_DEV_SLACK_APP_ID",
  "OPENBOT_DEV_SLACK_APP_TOKEN",
  "OPENBOT_DEV_SLACK_TUNNEL",
  "OPENBOT_DEV_SLACK_SIGNAL_HOSTNAME",
  "OPENBOT_DEV_SLACK_API_HOSTNAME",
] as const;
const TUNNEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const NAMED_TUNNEL_READY = /Registered tunnel connection/u;
const DEVELOPMENT_SLACK_APP_ID = "A0C5G5XGS83";
const SLACK_APP_ID_PATTERN = /^A[A-Z0-9]{1,31}$/u;
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u;
const TUNNEL_TIMEOUT_MS = 45_000;

interface TunnelledSpec {
  name: string;
  env: NodeJS.ProcessEnv;
}

export function readSlackDevelopmentValues(text: string, environment: NodeJS.ProcessEnv): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    const key = match?.[1];
    if (!key || !SLACK_KEYS.some((allowed) => allowed === key)) continue;
    values[key] = (match[2] ?? "").replace(/^(['"])(.*)\1$/u, "$2");
  }
  for (const key of SLACK_KEYS) {
    const fromShell = environment[key];
    if (fromShell) values[key] = fromShell;
  }
  return values;
}

export async function attachSlackTunnels(specs: TunnelledSpec[], projectRoot: string): Promise<() => void> {
  const file = join(projectRoot, SLACK_FILE);
  const values = readSlackDevelopmentValues(existsSync(file) ? readFileSync(file, "utf8") : "", process.env);
  if (!values.OPENBOT_DEV_SLACK_SIGNING_SECRET) {
    throw new Error(`--slack needs OPENBOT_DEV_SLACK_SIGNING_SECRET in ${SLACK_FILE} or the shell.`);
  }
  const appId = values.OPENBOT_DEV_SLACK_APP_ID || DEVELOPMENT_SLACK_APP_ID;
  if (!SLACK_APP_ID_PATTERN.test(appId)) {
    throw new Error(`OPENBOT_DEV_SLACK_APP_ID in ${SLACK_FILE} must be a Slack app ID, such as A0C5G5XGS83.`);
  }
  const signalPort = specs.find((spec) => spec.name === "remote")?.env.REMOTE_SIGNAL_PORT;
  const apiPort = specs.find((spec) => spec.name === "api")?.env.OPENBOT_API_PORT;
  if (!signalPort || !apiPort || !specs.some((spec) => spec.name === "app"))
    throw new Error("--slack needs Signal, the account API and the app: use the app or all target.");
  const callbackPort = String(await freePort());

  const tunnels: ChildProcess[] = [];
  const close = () => {
    for (const tunnel of tunnels) if (tunnel.exitCode === null) tunnel.kill("SIGTERM");
  };
  process.once("exit", close);
  try {
    const [signalUrl, apiUrl] = values.OPENBOT_DEV_SLACK_TUNNEL
      ? await openNamedTunnel(values, { signalPort, apiPort }, tunnels)
      : await Promise.all([openTunnel(signalPort, tunnels), openTunnel(apiPort, tunnels)]);
    const tunnelledSignalUrl = `${signalUrl.replace("https://", "wss://")}/v1/signal`;
    const tunnelled = {
      REMOTE_SIGNAL_URL: tunnelledSignalUrl,
      OPENBOT_REMOTE_SIGNAL_URL: tunnelledSignalUrl,
      SLACK_SIGNING_SECRET: `${appId}:${values.OPENBOT_DEV_SLACK_SIGNING_SECRET}`,
      ...(values.OPENBOT_DEV_SLACK_APP_TOKEN
        ? { SLACK_APP_TOKEN: `${appId}:${values.OPENBOT_DEV_SLACK_APP_TOKEN}` }
        : {}),
      SLACK_DEV_PUBLIC_ORIGIN: apiUrl,
      OPENBOT_DEV_SLACK_CALLBACK_PORT: callbackPort,
    };
    for (const spec of specs) Object.assign(spec.env, tunnelled);
    if (!values.OPENBOT_DEV_SLACK_APP_TOKEN)
      logger.warn(
        `OPENBOT_DEV_SLACK_APP_TOKEN is not in ${SLACK_FILE}: Signal cannot route direct messages and inbox messages.`,
      );
    logger.info(
      `Set the development Slack app's request URL to ${signalUrl}/v1/slack/events and its redirect URL to ${apiUrl}/v2/slack/callback.`,
    );
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port for the Slack install listener."))));
    });
  });
}

async function openNamedTunnel(
  values: Record<string, string>,
  ports: { signalPort: string; apiPort: string },
  tunnels: ChildProcess[],
): Promise<[string, string]> {
  const name = values.OPENBOT_DEV_SLACK_TUNNEL ?? "";
  const signalHostname = values.OPENBOT_DEV_SLACK_SIGNAL_HOSTNAME ?? "";
  const apiHostname = values.OPENBOT_DEV_SLACK_API_HOSTNAME ?? "";
  if (!TUNNEL_NAME_PATTERN.test(name)) {
    throw new Error(`OPENBOT_DEV_SLACK_TUNNEL in ${SLACK_FILE} must be the name of a cloudflared tunnel.`);
  }
  if (!HOSTNAME_PATTERN.test(signalHostname) || !HOSTNAME_PATTERN.test(apiHostname) || signalHostname === apiHostname) {
    throw new Error(
      `OPENBOT_DEV_SLACK_TUNNEL needs two different hostnames of the tunnel in ${SLACK_FILE}: ` +
        "OPENBOT_DEV_SLACK_SIGNAL_HOSTNAME and OPENBOT_DEV_SLACK_API_HOSTNAME.",
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "openbot-slack-tunnel-"));
  const config = join(directory, "config.yml");
  writeFileSync(
    config,
    [
      "ingress:",
      `  - hostname: ${signalHostname}`,
      `    service: http://127.0.0.1:${ports.signalPort}`,
      `  - hostname: ${apiHostname}`,
      `    service: http://127.0.0.1:${ports.apiPort}`,
      "  - service: http_status:404",
      "",
    ].join("\n"),
  );
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--config", config, "run", name], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  tunnels.push(tunnel);
  tunnel.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  await waitForOutput(tunnel, NAMED_TUNNEL_READY, `cloudflared did not connect the tunnel ${name}.`);
  return [`https://${signalHostname}`, `https://${apiHostname}`];
}

function openTunnel(port: string, tunnels: ChildProcess[]): Promise<string> {
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: developmentChildEnvironment(process.env, "app"),
  });
  tunnels.push(tunnel);
  return waitForOutput(tunnel, TUNNEL_URL, `cloudflared did not open a tunnel to port ${port}.`);
}

function waitForOutput(tunnel: ChildProcess, pattern: RegExp, timeoutMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => fail(new Error(timeoutMessage)), TUNNEL_TIMEOUT_MS);
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_192);
      const match = pattern.exec(output)?.[0];
      if (!match) return;
      clearTimeout(timer);
      tunnel.stdout?.off("data", read);
      tunnel.stderr?.off("data", read);
      tunnel.stdout?.resume();
      tunnel.stderr?.resume();
      resolve(match);
    };
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    tunnel.stdout?.on("data", read);
    tunnel.stderr?.on("data", read);
    tunnel.once("error", () =>
      fail(new Error("cloudflared is not installed. Install it with `brew install cloudflared`.")),
    );
    tunnel.once("exit", (code) => fail(new Error(`cloudflared stopped with code ${code ?? "unknown"}.`)));
  });
}
