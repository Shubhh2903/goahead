// `bun run dev:slack`: the dev stack, reachable by Slack. Slack accepts only public HTTPS addresses,
// so this opens two `cloudflared` quick tunnels: one to the local Signal, which takes the
// development Slack app's events, and one to the local account API, which takes the install's
// return. The dev app gets a loopback port for the end of the install, so the grant reaches it and
// not an installed OpenBot that owns `openbot://`. The tunnels live as long as this process. Their
// addresses change at each start: the development app's request and redirect URLs must follow.
//
// `.env.slack-dev` in the worktree root holds the signing secret, and `apps/auth-api/.env.dev` the
// development app's `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_STATE_SECRET`. Git ignores
// both:
//
//   OPENBOT_DEV_SLACK_SIGNING_SECRET='…'   (the development app, api.slack.com/apps > Basic Information)
//   OPENBOT_DEV_SLACK_APP_ID='A…'          (only for a Slack app of your own; absent, the shared dev app)
//
// A quick tunnel gets a new address at each start, and the Slack app's URLs must follow. A named
// Cloudflare tunnel on a domain of yours keeps its addresses. Create it once (docs/messaging.md),
// then name it and its two hostnames here, and the script runs it instead of the quick tunnels:
//
//   OPENBOT_DEV_SLACK_TUNNEL='goahead-dev'
//   OPENBOT_DEV_SLACK_SIGNAL_HOSTNAME='signal-dev.example.com'
//   OPENBOT_DEV_SLACK_API_HOSTNAME='api-dev.example.com'

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("dev-slack");

const SLACK_FILE = ".env.slack-dev";
const SLACK_KEYS = [
  "OPENBOT_DEV_SLACK_SIGNING_SECRET",
  "OPENBOT_DEV_SLACK_APP_ID",
  "OPENBOT_DEV_SLACK_TUNNEL",
  "OPENBOT_DEV_SLACK_SIGNAL_HOSTNAME",
  "OPENBOT_DEV_SLACK_API_HOSTNAME",
] as const;
const TUNNEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
/** What cloudflared prints when a named tunnel has its first connection to Cloudflare. */
const NAMED_TUNNEL_READY = /Registered tunnel connection/u;
/** `OpenBot (dev)`, the app that `apps/slack-app/development` describes. */
/** The shared `GoAhead (dev)` app. A developer without access to it names their own app instead. */
const DEVELOPMENT_SLACK_APP_ID = "A0C5G5XGS83";
const SLACK_APP_ID_PATTERN = /^A[A-Z0-9]{1,31}$/u;
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u;
const TUNNEL_TIMEOUT_MS = 45_000;

interface TunnelledSpec {
  name: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Reads the Slack values: `KEY=value` or `export KEY='value'` lines, and only the keys above. A
 * value set in the shell wins over the file.
 */
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

/**
 * Opens the tunnels and points every service of the stack at them. Returns the function that closes
 * them. Stops the start when a tunnel or the signing secret is missing: a stack that Slack cannot
 * reach would look like a bug in the app.
 */
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
      // The app's content security policy allows only `wss://*.openbot.run` and a local `ws:` Signal.
      // The host's socket to Signal goes through the tunnel too, so the policy must allow it, through
      // the same variable a self-hosted Signal uses (docs/self-hosting.md).
      OPENBOT_REMOTE_SIGNAL_URL: tunnelledSignalUrl,
      // Signal binds each signing secret to its app.
      SLACK_SIGNING_SECRET: `${appId}:${values.OPENBOT_DEV_SLACK_SIGNING_SECRET}`,
      SLACK_DEV_PUBLIC_ORIGIN: apiUrl,
      OPENBOT_DEV_SLACK_CALLBACK_PORT: callbackPort,
    };
    for (const spec of specs) Object.assign(spec.env, tunnelled);
    logger.info(
      `Set the development Slack app's request URL to ${signalUrl}/v1/slack/events and its redirect URL to ${apiUrl}/v2/slack/callback.`,
    );
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

/** A loopback port that nothing listens on now. The dev app binds it when it starts. */
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

/**
 * One named tunnel with a fixed hostname for Signal and one for the account API. cloudflared finds
 * the tunnel's credentials by its name, from `cloudflared tunnel login` and `tunnel create`. The
 * ingress rules carry this stack's ports, so the config is written for each start.
 */
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
  });
  tunnels.push(tunnel);
  return waitForOutput(tunnel, TUNNEL_URL, `cloudflared did not open a tunnel to port ${port}.`);
}

/** The first match of `pattern` in what cloudflared prints, or a failure when it stops or stays quiet. */
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
      // Keep draining, so a full pipe never stops the tunnel.
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
