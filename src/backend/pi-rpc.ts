import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { RequestTimeoutError } from "./agent-client";
import type { SpawnTarget } from "./process-confinement";
import { createDiagnosticStream } from "./stderr-diagnostics";
import { stopWindowsProcessTree } from "./windows-process-tree";

const PI_RECORD_LIMIT_BYTES = 256 * 1024 * 1024;

interface PendingRequest {
  resolve: (value: DynamicRecord) => void;
  reject: (error: Error) => void;
}

/** Owns one Pi RPC process and its correlated requests. Session policy belongs to the client. */
export class PiRpc extends EventEmitter<{ record: [DynamicRecord]; diagnostic: [string]; exit: [Error] }> {
  readonly #pending = new Map<string, PendingRequest>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #stopping = false;
  constructor(private readonly redact: (text: string) => string) {
    super();
  }

  start(target: SpawnTarget, cwd: string, env: NodeJS.ProcessEnv): void {
    if (this.#child) throw new Error("Pi process is already running.");
    const child = spawn(target.command, target.args, {
      cwd,
      env,
      stdio: "pipe",
      windowsHide: true,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      detached: process.platform !== "win32",
    });
    this.#child = child;
    const decoder = new StringDecoder("utf8");
    let buffered = "";
    const diagnostics = createDiagnosticStream({ redact: this.redact, emit: (line) => this.emit("diagnostic", line) });
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      const safe = new Error(this.redact(error.message));
      for (const pending of this.#pending.values()) pending.reject(safe);
      this.#pending.clear();
      if (!this.#stopping) this.emit("exit", safe);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => diagnostics.push(chunk));
    child.stdin.on("error", fail);
    child.once("error", fail);
    child.once("close", (code, signal) => {
      diagnostics.flush();
      fail(new Error(`Pi process closed (${signal ?? code ?? "unknown"}).`));
      if (this.#child === child) this.#child = null;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += decoder.write(chunk);
      try {
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (Buffer.byteLength(line) > PI_RECORD_LIMIT_BYTES) throw new Error("Pi RPC record is too large.");
          if (line.trim()) this.#record(JSON.parse(line));
          newline = buffered.indexOf("\n");
        }
        if (Buffer.byteLength(buffered) > PI_RECORD_LIMIT_BYTES) throw new Error("Pi RPC record is too large.");
      } catch {
        buffered = "";
        fail(new Error("Pi returned an invalid RPC record."));
        child.kill("SIGTERM");
      }
    });
  }

  #record(value: unknown): void {
    if (!isDynamicRecord(value) || typeof value.type !== "string") throw new Error("Invalid Pi RPC record.");
    if (value.type !== "response") {
      this.emit("record", value);
      return;
    }
    if (typeof value.id !== "string") return;
    const pending = this.#pending.get(value.id);
    if (!pending) return;
    this.#pending.delete(value.id);
    if (value.success === true) pending.resolve(isDynamicRecord(value.data) ? value.data : {});
    else pending.reject(new Error(this.redact(typeof value.error === "string" ? value.error : "Pi request failed.")));
  }

  request(command: DynamicRecord, timeoutMs = 30_000): Promise<DynamicRecord> {
    const id = randomUUID();
    return new Promise<DynamicRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RequestTimeoutError("Pi", String(command.type)));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.send({ ...command, id });
      } catch (cause) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  send(record: DynamicRecord): void {
    const child = this.#child;
    if (!child || child.stdin.destroyed || child.stdin.writableEnded) throw new Error("Pi is not running.");
    child.stdin.write(`${JSON.stringify(record)}\n`);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#child;
    if (!child) return;
    if (process.platform === "win32") {
      await stopWindowsProcessTree(child);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const signal = (value: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, value);
        } catch {
          /* The process group already exited. */
        }
      };
      const terminate = setTimeout(() => signal("SIGTERM"), 1_000);
      const kill = setTimeout(() => signal("SIGKILL"), 3_000);
      child.once("close", () => {
        clearTimeout(terminate);
        clearTimeout(kill);
        signal("SIGKILL");
        resolve();
      });
      child.stdin.end();
    });
  }
}
