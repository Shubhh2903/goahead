import { readFile } from "node:fs/promises";
import {
  type AgentMemoryLimitPreference,
  DEFAULT_AGENT_MEMORY_LIMIT,
  isAgentMemoryLimit,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

/**
 * How many memories one agent can hold. The backend reads it each time a memory is added, so it is
 * held in memory after `load` rather than read from disk each time.
 *
 * A file that is missing, unreadable as JSON or names a value that is not a choice reads as the
 * default, which was the fixed cap before the setting existed. Writes are chained for the reason
 * `update-preference-store.ts` chains its own.
 */
export class AgentMemoryLimitPreferenceStore {
  readonly #path: string;
  #preference: AgentMemoryLimitPreference = { limit: DEFAULT_AGENT_MEMORY_LIMIT };
  #pendingWrite: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8"));
      if (isDynamicRecord(parsed) && parsed.version === 1 && isAgentMemoryLimit(parsed.limit)) {
        this.#preference = { limit: parsed.limit };
      }
    } catch (error) {
      if (!isMissingFileError(error) && !(error instanceof SyntaxError)) throw error;
    }
  }

  get(): AgentMemoryLimitPreference {
    return { ...this.#preference };
  }

  set(preference: AgentMemoryLimitPreference): Promise<AgentMemoryLimitPreference> {
    const write = this.#pendingWrite.then(
      () => this.#replace(preference),
      () => this.#replace(preference),
    );
    this.#pendingWrite = write.catch(() => undefined);
    return write;
  }

  async #replace(preference: AgentMemoryLimitPreference): Promise<AgentMemoryLimitPreference> {
    await writeJsonFileAtomically(this.#path, { version: 1, limit: preference.limit });
    this.#preference = { limit: preference.limit };
    return this.get();
  }
}
