// The "Agent that handles mail" setting of the Google panel: `google-mail-agent.json` in user data.
// Not a secret, so not encrypted. It is kept when Google is disconnected, so a new sign-in keeps it.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

const fileSchema = z.object({ version: z.literal(1), agentId: z.string().min(1).max(128) });

export class GoogleMailAgentStore {
  readonly #path: string;
  #agentId: string | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  /** A missing file is no setting. A file that cannot be read is no setting too; the error is returned for the log. */
  async load(): Promise<Error | null> {
    try {
      this.#agentId = fileSchema.parse(JSON.parse(await readFile(this.#path, "utf8"))).agentId;
      return null;
    } catch (error) {
      this.#agentId = null;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  read(): string | null {
    return this.#agentId;
  }

  async write(agentId: string): Promise<void> {
    await writeJsonFileAtomically(this.#path, { version: 1, agentId }, { createDirectory: true });
    this.#agentId = agentId;
  }
}
