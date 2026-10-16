import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RoutineFeed } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

const logger = createOpenBotLogger("routine-feed");

const FEED_PATH = /^\/routines\/([A-Za-z0-9_-]+)\.ics$/;
const storedFeedSchema = z.object({
  version: z.literal(1),
  /** The token, encrypted with the secret storage cipher, in base64. */
  token: z.string().min(1),
  /** The port the feed had last, so the URL that a calendar app holds still works after a restart. */
  port: z.number().int().min(1).max(65_535),
});

/** The agent filter names no agent of this computer. */
export class RoutineFeedAgentNotFound extends Error {
  constructor() {
    super("The routine feed agent was not found.");
    this.name = "RoutineFeedAgentNotFound";
  }
}

interface SecretCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface RoutineFeedServerOptions {
  /** The file that keeps the encrypted token and the port. */
  path: string;
  cipher: SecretCipher;
  /** The iCalendar text of every routine, or of the routines of one agent. Throws `RoutineFeedAgentNotFound`. */
  document: (agentId: string | null) => Promise<string>;
}

/**
 * The loopback door through which a calendar app on this computer reads the routine schedule.
 *
 * A calendar app cannot send a header, so the private token is in the path. The token is the only
 * credential: the URL alone gives read access, and a new token makes the old URL answer 404. A
 * request with an `Origin` header or a foreign `Host` is refused before the token is read, so a web
 * page cannot read the feed through DNS rebinding. The feed only reads; it never changes a routine.
 */
export class RoutineFeedServer {
  readonly #options: RoutineFeedServerOptions;
  #server: Server | null = null;
  #port = 0;
  #token: Buffer = Buffer.alloc(0);
  /** One state change at a time, in the order the calls came. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RoutineFeedServerOptions) {
    this.#options = options;
  }

  /** Opens the feed that the user turned on before. Never fails: a feed that cannot open is off. */
  start(): Promise<void> {
    return this.#locked(async () => {
      let stored: { token: string; port: number } | null;
      try {
        stored = await this.#read();
      } catch (error) {
        logger.warn("The routine feed could not be read. It stays off.", error);
        return;
      }
      if (!stored) return;
      try {
        await this.#open(stored.token, stored.port);
      } catch (error) {
        logger.warn("The routine feed could not open.", error);
        return;
      }
      if (this.#port === stored.port) return;
      // The port was not free. Keep the new one, so the URL that the user subscribes to now stays.
      try {
        await this.#write(stored.token, this.#port);
      } catch (error) {
        logger.warn("The new routine feed port could not be saved.", error);
      }
    });
  }

  status(): Promise<RoutineFeed> {
    return this.#locked(async () => this.#status());
  }

  /** Turns the feed on with a new token. A feed that is on gets a new URL, and the old one stops working. */
  create(): Promise<RoutineFeed> {
    return this.#locked(async () => {
      const token = randomBytes(32).toString("base64url");
      let storedPort = 0;
      if (!this.#server) {
        try {
          storedPort = (await this.#read())?.port ?? 0;
        } catch {
          storedPort = 0;
        }
      }
      const port = this.#server ? this.#port : storedPort;
      const previous = this.#server ? this.#token : null;
      await this.#open(token, port);
      try {
        await this.#write(token, this.#port);
      } catch (error) {
        // Unsaved, the new URL would stop working at the next start, so the feed stays as it was.
        if (previous) this.#token = previous;
        else await this.#close();
        throw error;
      }
      logger.info("The routine feed has a new URL.");
      return this.#status();
    });
  }

  /** Turns the feed off. The URL stops working, and the next `create` makes a new one. */
  remove(): Promise<RoutineFeed> {
    return this.#locked(async () => {
      await rm(this.#options.path, { force: true });
      await this.#close();
      logger.info("The routine feed is off.");
      return this.#status();
    });
  }

  stop(): Promise<void> {
    return this.#locked(() => this.#close());
  }

  #locked<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #status(): RoutineFeed {
    if (!this.#server || this.#token.length === 0) return { url: null };
    return { url: `http://127.0.0.1:${this.#port}/routines/${this.#token.toString()}.ics` };
  }

  async #read(): Promise<{ token: string; port: number } | null> {
    const { path, cipher } = this.#options;
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    const stored = storedFeedSchema.parse(JSON.parse(text));
    return { token: cipher.decrypt(Buffer.from(stored.token, "base64")), port: stored.port };
  }

  async #write(token: string, port: number): Promise<void> {
    const encrypted = this.#options.cipher.encrypt(token).toString("base64");
    await writeJsonFileAtomically(
      this.#options.path,
      { version: 1, token: encrypted, port },
      { createDirectory: true },
    );
  }

  /** Listens on `port`, or on a new port when another program took it, and takes `token`. */
  async #open(token: string, port: number): Promise<void> {
    registerSecretValue(token);
    if (!this.#server) {
      const server = createServer((request, response) => void this.#handle(request, response));
      try {
        await listen(server, port);
      } catch (error) {
        if (port === 0) throw error;
        logger.warn(`Port ${port} of the routine feed is not free. The feed gets a new URL.`);
        await listen(server, 0);
      }
      const address = server.address();
      if (!address || isString(address)) {
        server.close();
        throw new Error("Unable to bind the routine feed.");
      }
      this.#server = server;
      this.#port = address.port;
    }
    this.#token = Buffer.from(token);
  }

  async #close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#token = Buffer.alloc(0);
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const host = request.headers.host;
      if ((host !== `127.0.0.1:${this.#port}` && host !== `localhost:${this.#port}`) || request.headers.origin) {
        return sendText(response, 403, "Forbidden");
      }
      if (request.method !== "GET" && request.method !== "HEAD") return sendText(response, 405, "Method not allowed");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const token = FEED_PATH.exec(url.pathname)?.[1];
      // A wrong token gets the same answer as a path that does not exist.
      if (!token || !this.#authorized(token)) return sendText(response, 404, "Not found");
      let document: string;
      try {
        document = await this.#options.document(url.searchParams.get("agent"));
      } catch (error) {
        if (error instanceof RoutineFeedAgentNotFound) return sendText(response, 404, "Not found");
        throw error;
      }
      const body = Buffer.from(document);
      response.writeHead(200, {
        "content-type": "text/calendar; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      // The URL holds the token, so the log names neither.
      logger.warn("A routine feed request failed.", error);
      if (!response.headersSent) sendText(response, 500, "Internal error");
    }
  }

  #authorized(candidate: string): boolean {
    const value = Buffer.from(candidate);
    return this.#token.length > 0 && value.length === this.#token.length && timingSafeEqual(value, this.#token);
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}
