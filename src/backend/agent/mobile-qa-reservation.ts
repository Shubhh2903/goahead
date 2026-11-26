import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../atomic-json-file";
import { isMissingFileError } from "../file-errors";

/**
 * How long a reservation holds after its last acquire. An agent that stops, crashes or forgets to
 * release cannot block the shared device after this time. The holder extends it by acquiring again.
 */
export const MOBILE_QA_RESERVATION_TTL_MS = 30 * 60_000;

export const mobileQaReservationInput = z
  .object({
    action: z.enum(["acquire", "release"]),
    reservationId: z.string().uuid().optional().describe("Required for release. Use the id returned by acquire."),
  })
  .strict();

const storedReservation = z.object({
  version: z.literal(1),
  holder: z
    .object({
      agentId: z.string().min(1),
      reservationId: z.string().uuid(),
      expiresAt: z.number().int().nonnegative(),
    })
    .nullable(),
});

type Holder = NonNullable<z.infer<typeof storedReservation>["holder"]>;

export interface MobileQaReservationOptions {
  now?: () => number;
}

/** The device, app data, local API and bundler make up one shared test environment on this host. */
export class MobileQaReservation {
  readonly #file: string;
  readonly #now: () => number;
  #pending = Promise.resolve();

  constructor(userDataPath: string, options: MobileQaReservationOptions = {}) {
    this.#file = join(userDataPath, "mobile-qa-reservation-v1.json");
    this.#now = options.now ?? Date.now;
  }

  update(input: z.infer<typeof mobileQaReservationInput>, agentId: string, agentExists: (id: string) => boolean) {
    const result = this.#pending.then(() => this.#update(input, agentId, agentExists));
    this.#pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** The current holder, or null when there is none, it expired, or the file is not a reservation this release wrote. */
  async #holder(): Promise<Holder | null> {
    const text = await readFile(this.#file, "utf8").catch((error: unknown) => {
      if (isMissingFileError(error)) return null;
      throw error;
    });
    if (text === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = storedReservation.safeParse(json);
    const holder = parsed.success ? parsed.data.holder : null;
    return holder && holder.expiresAt > this.#now() ? holder : null;
  }

  async #update(
    input: z.infer<typeof mobileQaReservationInput>,
    agentId: string,
    agentExists: (id: string) => boolean,
  ) {
    const holder = await this.#holder();
    if (input.action === "release") {
      if (!input.reservationId) throw new Error(sourceText("error.backend.mobileQaReservationIdRequired"));
      if (!holder) return { status: "released" };
      if (holder.agentId !== agentId || holder.reservationId !== input.reservationId) return { status: "not_owner" };
      await Effect.runPromise(writeJsonFileAtomically(this.#file, { version: 1, holder: null }));
      return { status: "released" };
    }
    if (holder && holder.agentId !== agentId && agentExists(holder.agentId)) {
      return { status: "busy", agentId: holder.agentId, expiresAt: new Date(holder.expiresAt).toISOString() };
    }
    // The holder acquiring again keeps its id and extends the expiry.
    const reservationId = holder?.agentId === agentId ? holder.reservationId : randomUUID();
    const expiresAt = this.#now() + MOBILE_QA_RESERVATION_TTL_MS;
    await Effect.runPromise(
      writeJsonFileAtomically(this.#file, { version: 1, holder: { agentId, reservationId, expiresAt } }),
    );
    return { status: "acquired", reservationId, expiresAt: new Date(expiresAt).toISOString() };
  }
}
