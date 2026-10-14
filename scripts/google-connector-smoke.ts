// `bun run smoke:google-connector`: the Gmail and Google Calendar connector in a real dev app,
// against the fake Google of `src/main/google-test-server.ts`. No real Google account is used.
//
// It starts this worktree's dev stack with an isolated profile and the fake Google's client and
// address, drives Server settings > Connectors with `bun run dev:automation`, and writes
// `.openbot-build/google-connector/smoke.json`. It stops only the stack it started (`bun run dev:stop`).
// It refuses to start when this worktree already runs a dev stack.
//
// Covered: connect through the consent page, the panel, the watcher's first polls, a new mail that
// reaches the watcher, and disconnect with revoke. Not covered here: the triage session (it needs a
// Claude sign-in and a picked mail agent), send and book. The unit tests cover those with the same
// fake Google and a fake session.
//
// After a failure that follows the connect step, cleanup tries to disconnect Google, so the isolated
// profile keeps no record that points at the dead fake server. If that fails, reset the profile.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { FAKE_GOOGLE_CLIENT, type FakeGoogleServer, startFakeGoogleServer } from "../src/main/google-test-server";

const logger = createOpenBotLogger("google-connector-smoke");
const REPORT_DIRECTORY = resolve(".openbot-build/google-connector");
const START_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 60_000;
const WATCH_INTERVAL_MS = 3_000;

const instancesSchema = z.object({
  instances: z.array(z.object({ instanceId: z.string(), projectRoot: z.string(), service: z.string() })),
});

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

const steps: Step[] = [];

function automation(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("bun", ["run", "dev:automation", ...args], { encoding: "utf8" });
  if (result.status !== 0) logger.warn(`dev:automation ${args[0] ?? ""} failed: ${result.stderr ?? ""}`);
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function instanceOfThisWorktree(): string | null {
  const result = automation(["instances"]);
  if (!result.ok) return null;
  let output: unknown;
  try {
    output = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("`bun run dev:automation instances` did not print JSON.");
  }
  const parsed = instancesSchema.safeParse(output);
  if (!parsed.success) return null;
  const own = parsed.data.instances.find(
    (instance) => instance.service === "app" && resolve(instance.projectRoot) === resolve(process.cwd()),
  );
  return own?.instanceId ?? null;
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  return check();
}

function record(name: string, ok: boolean, detail?: string): boolean {
  steps.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  logger.info(`${ok ? "ok" : "FAILED"} ${name}${detail ? `: ${detail}` : ""}`);
  return ok;
}

function click(instance: string, role: string, name: string, extra: string[] = []): boolean {
  return automation([
    "click",
    `--role=${role}`,
    `--name=${name}`,
    "--allow-mutations",
    `--instance=${instance}`,
    `--timeout=${STEP_TIMEOUT_MS}`,
    ...extra,
  ]).ok;
}

function requested(fake: FakeGoogleServer, path: string): number {
  return fake.requests.filter((request) => request.path === path).length;
}

async function run(
  fake: FakeGoogleServer,
  stack: { child: ChildProcess | null; connectedInstance: string | null },
): Promise<void> {
  if (instanceOfThisWorktree() !== null) {
    record("no dev stack runs in this worktree", false, "Stop it with `bun run dev:stop`, then run the smoke again.");
    return;
  }
  stack.child = spawn("bun", ["run", "dev", "--isolated"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENBOT_GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT.clientId,
      OPENBOT_GOOGLE_CLIENT_SECRET: FAKE_GOOGLE_CLIENT.clientSecret,
      OPENBOT_DEV_GOOGLE_API_ORIGIN: fake.origin,
      OPENBOT_DEV_GMAIL_WATCH_INTERVAL_MS: String(WATCH_INTERVAL_MS),
    },
  });
  const found: { id: string | null } = { id: null };
  const started = await waitUntil(() => {
    found.id = instanceOfThisWorktree();
    return found.id !== null;
  }, START_TIMEOUT_MS);
  if (!record("the dev app starts", started) || found.id === null) return;
  const id = found.id;

  if (!record("open the server menu", click(id, "button", "Open server menu for"))) return;
  if (!record("open Server settings", click(id, "menuitem", "Server settings", ["--exact"]))) return;
  if (!record("open Connectors", click(id, "tab", "Connectors", ["--exact"]))) return;
  if (!record("open the Google page", click(id, "button", "Open Gmail and Google Calendar"))) return;
  const connected = click(id, "button", "Connect Google", ["--wait-for=button,Disconnect"]);
  if (!record("connect through the fake consent page", connected)) return;
  stack.connectedInstance = id;
  record("the code was exchanged", fake.tokenGrants.includes("authorization_code"));
  const screenshot = automation(["screenshot", `--instance=${id}`]);
  record("screenshot of the connected panel", screenshot.ok, screenshot.stdout.trim());

  const watching = await waitUntil(() => requested(fake, "/gmail/v1/users/me/history") > 0, STEP_TIMEOUT_MS);
  if (!record("the watcher reads the Gmail history", watching)) return;
  fake.addMessage({
    id: "smoke-important",
    threadId: "smoke-thread",
    labelIds: ["INBOX", "IMPORTANT"],
    from: "Smoke Sender <smoke@example.com>",
    to: "owner@example.com",
    subject: "Smoke test",
    date: new Date().toUTCString(),
    snippet: "A new important mail.",
    text: "A new important mail.",
    messageIdHeader: "<smoke-important@example.com>",
  });
  const selected = await waitUntil(
    () => requested(fake, "/gmail/v1/users/me/messages/smoke-important") > 0,
    STEP_TIMEOUT_MS,
  );
  record("the watcher reads the new important mail", selected);

  const disconnected = click(id, "button", "Disconnect", ["--exact", "--wait-for=button,Connect Google"]);
  record("disconnect", disconnected);
  if (disconnected) stack.connectedInstance = null;
  record("disconnect revoked the token at Google", fake.revokedTokens.length === 1);
}

const fake = await startFakeGoogleServer();
const stack: { child: ChildProcess | null; connectedInstance: string | null } = {
  child: null,
  connectedInstance: null,
};
const startedAt = new Date().toISOString();
try {
  await run(fake, stack);
} catch (error) {
  record("the smoke ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  if (stack.connectedInstance !== null) {
    const cleaned = click(stack.connectedInstance, "button", "Disconnect", ["--exact"]);
    if (!cleaned) logger.warn("Cleanup could not disconnect Google. Reset the isolated profile.");
  }
  if (stack.child) spawnSync("bun", ["run", "dev:stop"], { stdio: "inherit" });
  await fake.close();
  mkdirSync(REPORT_DIRECTORY, { recursive: true });
  const passed = steps.length > 0 && steps.every((step) => step.ok);
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    passed,
    steps,
    google: {
      tokenGrants: fake.tokenGrants,
      revokedTokens: fake.revokedTokens.length,
      historyReads: requested(fake, "/gmail/v1/users/me/history"),
      profileReads: requested(fake, "/gmail/v1/users/me/profile"),
    },
  };
  writeFileSync(join(REPORT_DIRECTORY, "smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Report: ${join(REPORT_DIRECTORY, "smoke.json")}`);
  process.exitCode = passed ? 0 : 1;
}
