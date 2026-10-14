// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiAgentClient } from "./pi-client";
import { createPiMcpExtension } from "./pi-mcp";
import { type AppServerNotification, decodeThreadResponse, decodeTurnResponse, getRecord, getString } from "./protocol";

// Failure modes: agent_end can precede retries, so only agent_settled completes a turn (settled
// test); a restarted process can load a different session (resume test); a provider secret can
// reach a notification (redaction test); credentials can enter a generated file or become a
// shell command (MCP test).
const SECRET = "pi-secret-value-4417";
// Literal `${...}` text, which Pi must not expand.
const LITERAL_REFERENCE = "$" + "{DO_NOT_EXPAND}";
const VALUE_REFERENCE = "$" + "{OPENBOT_PI_MCP_VALUE_0}";
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
let session = path.join(process.cwd(), "pi-session.jsonl");
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
let buffer = "";
process.stdin.on("data", chunk => {
  buffer += chunk;
  let line;
  while ((line = buffer.indexOf("\\n")) >= 0) {
    const command = JSON.parse(buffer.slice(0, line)); buffer = buffer.slice(line + 1);
    fs.appendFileSync(path.join(process.cwd(), "commands.jsonl"), JSON.stringify(command) + "\\n");
    let data = {};
    if (command.type === "get_state") { fs.writeFileSync(session, "{}"); data = { sessionFile: session }; }
    if (command.type === "switch_session") session = command.sessionPath;
    if (command.type === "get_messages") data = { messages: [] };
    if (command.type === "prompt") {
      data = { disposition: "started" };
      const text = command.message === "leak" ? "token " + process.env.PI_TEST_SECRET : "Partial";
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
      send({ type: "agent_end" });
    }
    send({ type: "response", id: command.id, command: command.type, success: true, data });
    if (command.type === "compact") {
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Final" }], stopReason: "stop" } });
      send({ type: "agent_settled" });
    }
    if (command.type === "abort") send({ type: "agent_settled" });
  }
});
`;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-pi-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, "pi.cjs");
  await writeFile(script, FAKE, { mode: 0o755 });
  const executable = process.platform === "win32" ? join(directory, "pi.cmd") : script;
  if (process.platform === "win32")
    await writeFile(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const client = new PiAgentClient(
    { executable, version: "1.1.0", source: "system" },
    { providerStateDirectory: directory, extraEnv: () => ({ PI_TEST_SECRET: SECRET }) },
  );
  client.start();
  cleanup.push(() => client.stop());
  const events: AppServerNotification[] = [];
  client.on("notification", (event) => events.push(event));
  const started = await client.request("thread/start", { cwd: directory }, decodeThreadResponse);
  return { client, directory, events, id: started.thread.id };
}

function completed(client: PiAgentClient) {
  return new Promise<AppServerNotification>((resolve) => {
    const listener = (event: AppServerNotification) => {
      if (event.method === "turn/completed") {
        client.off("notification", listener);
        resolve(event);
      }
    };
    client.on("notification", listener);
  });
}

describe("Pi native sessions", () => {
  it("keeps a turn open after agent_end and completes it on agent_settled", async () => {
    const test = await fixture();
    await test.client.request(
      "turn/start",
      { threadId: test.id, input: [{ type: "text", text: "Run" }] },
      decodeTurnResponse,
    );
    // A correlated read is a protocol barrier after the fixture's agent_end record.
    await test.client.request("thread/read", { threadId: test.id, includeTurns: true }, decodeThreadResponse);
    expect(test.events.filter((event) => event.method === "turn/completed")).toHaveLength(0);
    const finished = completed(test.client);
    await test.client.request("thread/compact/start", { threadId: test.id }, () => ({}));
    expect(getString(getRecord((await finished).params, "turn"), "status")).toBe("completed");
    const final = test.events
      .filter((event) => event.method === "item/completed")
      .map((event) => getString(getRecord(event.params, "item"), "text"));
    expect(final).toEqual(["Final"]);
  });

  it("clears queued work before interruption and resumes the same native session", async () => {
    const test = await fixture();
    await test.client.request(
      "turn/start",
      { threadId: test.id, input: [{ type: "text", text: "Run" }] },
      decodeTurnResponse,
    );
    const finished = completed(test.client);
    await test.client.request("turn/interrupt", { threadId: test.id }, () => ({}));
    expect(getString(getRecord((await finished).params, "turn"), "status")).toBe("interrupted");
    test.client.releaseIdleThreads();
    const resumed = await test.client.request(
      "thread/resume",
      { threadId: test.id, cwd: test.directory },
      decodeThreadResponse,
    );
    expect(resumed.thread.id).toBe(test.id);
    const commands = (await readFile(join(test.directory, "commands.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const types = commands.map((command) => command.type);
    expect(types.indexOf("clear_queue")).toBeLessThan(types.indexOf("abort"));
    expect(commands.filter((command) => command.type === "switch_session").at(-1)?.sessionPath).toBe(test.id);
  });

  it("redacts a provider environment value from notifications", async () => {
    const test = await fixture();
    await test.client.request(
      "turn/start",
      { threadId: test.id, input: [{ type: "text", text: "leak" }] },
      decodeTurnResponse,
    );
    await test.client.request("thread/read", { threadId: test.id, includeTurns: true }, decodeThreadResponse);
    const deltas = test.events.filter((event) => event.method === "item/agentMessage/delta");
    expect(deltas).toHaveLength(1);
    expect(JSON.stringify(test.events)).not.toContain(SECRET);
  });

  it("does not write MCP credentials to the extension and passes literal values through environment references", async () => {
    const extension = await createPiMcpExtension(
      {
        server: {
          type: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "!credential-command", Literal: LITERAL_REFERENCE },
        },
      },
      { servers: [], close() {}, setThreadId() {} },
    );
    cleanup.push(() => extension.close());
    const source = await readFile(extension.path, "utf8");
    expect(source).not.toContain("!credential-command");
    expect(source).not.toContain(LITERAL_REFERENCE);
    const entries = JSON.parse(extension.environment.OPENBOT_PI_MCP_SERVERS ?? "[]");
    expect(entries[0].config.headers.Authorization).toBe(VALUE_REFERENCE);
    expect(extension.environment.OPENBOT_PI_MCP_VALUE_0).toBe("!credential-command");
  });
});
