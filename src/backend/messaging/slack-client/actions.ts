import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { SLACK_CLIENT_LIMITS, type SlackClientUploadResult } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { HistoryMessage, MessagingAdapter } from "../messaging-types";
import { clientText } from "../slack/slack-driver";
import type { SlackCacheStore } from "./cache-store";

/** The Slack calls the person's actions need. Each one uses the person's user token. */
export type SlackClientActionAdapter = Required<
  Pick<MessagingAdapter, "postAsUser" | "updateAsUser" | "deleteAsUser" | "reactAsUser" | "uploadFileAsUser">
>;

export interface SlackClientActionsOptions {
  connectionId: string;
  store: SlackCacheStore;
  /** The live adapter of the connection, or null while it is not connected. */
  adapter(): Partial<SlackClientActionAdapter> | null;
  /** The Slack user id of the person who connected the workspace, or null without a user token. */
  ownerUserId(): string | null;
  /** The cache of one conversation changed. */
  onChanged(channelId: string): void;
  now?: () => string;
}

export interface SlackClientSendAction {
  channelId: string;
  text: string;
  threadTs?: string;
  /** Also show a thread reply in the conversation. */
  broadcast?: boolean;
}

export interface SlackClientEditAction {
  channelId: string;
  ts: string;
  text: string;
}

export interface SlackClientDeleteAction {
  channelId: string;
  ts: string;
}

export interface SlackClientReactAction {
  channelId: string;
  ts: string;
  name: string;
  on: boolean;
}

/** A file main picked by path, or the bytes of a file the renderer attached. */
export type SlackClientUploadSource = { path: string } | { name: string; bytes: Uint8Array };

export interface SlackClientUploadAction {
  channelId: string;
  threadTs?: string;
  source: SlackClientUploadSource;
  /** The message that shares the file. A send with a file is this one upload. */
  text?: string;
}

const MEGABYTE = 1024 * 1024;

/**
 * The person's own actions in the Slack client of one connection: send, edit, delete, react and
 * upload, as them with the user token. They need no approval and no send guard: the person does them
 * in GoAhead. Edit and delete are refused before any Slack call unless the cached author is the
 * person. Edit, delete and react change the cache first and restore it when Slack refuses; a send is
 * cached when Slack gives its `ts`. Errors name only Slack's error code, never a token or file address.
 */
export class SlackClientActions {
  readonly #options: SlackClientActionsOptions;
  readonly #now: () => string;

  constructor(options: SlackClientActionsOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async send(input: SlackClientSendAction): Promise<void> {
    const owner = this.#owner();
    const adapter = this.#adapter();
    if (!adapter.postAsUser) throw unsupported();
    checkText(input.text);
    const threadTs = input.threadTs;
    const broadcast = threadTs !== undefined && input.broadcast === true;
    const { ts } = await adapter.postAsUser({
      channel: input.channelId,
      ...(threadTs === undefined ? {} : { threadTs }),
      text: input.text,
      keepMentions: true,
      ...(broadcast ? { broadcast } : {}),
    });
    const message: HistoryMessage = {
      ts,
      threadTs: threadTs ?? null,
      replyCount: 0,
      latestReplyTs: null,
      authorId: owner,
      // What Slack keeps: the cache holds Slack's markup, and a live event for the same `ts` matches it.
      text: clientText(input.text),
      files: [],
      reactions: [],
      editedAt: null,
      deleted: false,
      subtype: broadcast ? "thread_broadcast" : null,
    };
    this.#options.store.upsertMessage(this.#options.connectionId, input.channelId, message);
    this.#options.onChanged(input.channelId);
  }

  async edit(input: SlackClientEditAction): Promise<void> {
    const owner = this.#owner();
    const adapter = this.#adapter();
    const updateAsUser = adapter.updateAsUser;
    if (!updateAsUser) throw unsupported();
    checkText(input.text);
    const before = this.#ownMessage(input.channelId, input.ts, owner);
    await this.#optimistic(
      input.channelId,
      before,
      () =>
        this.#options.store.markEdited(
          this.#options.connectionId,
          input.channelId,
          input.ts,
          clientText(input.text),
          this.#now(),
        ),
      () => updateAsUser.call(adapter, input.channelId, input.ts, input.text),
    );
  }

  async delete(input: SlackClientDeleteAction): Promise<void> {
    const owner = this.#owner();
    const adapter = this.#adapter();
    const deleteAsUser = adapter.deleteAsUser;
    if (!deleteAsUser) throw unsupported();
    const before = this.#ownMessage(input.channelId, input.ts, owner);
    await this.#optimistic(
      input.channelId,
      before,
      () => this.#options.store.markDeleted(this.#options.connectionId, input.channelId, input.ts),
      () => deleteAsUser.call(adapter, input.channelId, input.ts),
    );
  }

  async react(input: SlackClientReactAction): Promise<void> {
    const owner = this.#owner();
    const adapter = this.#adapter();
    const reactAsUser = adapter.reactAsUser;
    if (!reactAsUser) throw unsupported();
    const before = this.#cached(input.channelId, input.ts);
    const change = () =>
      this.#options.store.adjustReaction(
        this.#options.connectionId,
        input.channelId,
        input.ts,
        input.name,
        owner,
        input.on,
        owner,
      );
    if (!before) {
      // Nothing cached to change or restore: only Slack is told.
      await reactAsUser.call(adapter, input.channelId, input.ts, input.name, input.on);
      return;
    }
    await this.#optimistic(input.channelId, before, change, () =>
      reactAsUser.call(adapter, input.channelId, input.ts, input.name, input.on),
    );
  }

  /**
   * Uploads one file and shares it in the conversation, with `text` as its message. A file over the
   * limit is refused before it is read. The message arrives in the cache with Slack's event.
   */
  async upload(input: SlackClientUploadAction): Promise<SlackClientUploadResult> {
    this.#owner();
    const adapter = this.#adapter();
    if (!adapter.uploadFileAsUser) throw unsupported();
    const text = input.text?.trim() ? input.text : undefined;
    if (text !== undefined) checkText(text);
    const { name, bytes } = await readSource(input.source);
    const { fileId } = await adapter.uploadFileAsUser({
      channel: input.channelId,
      ...(input.threadTs === undefined ? {} : { threadTs: input.threadTs }),
      name,
      bytes,
      mimeType: attachmentMimeTypeForName(name),
      ...(text === undefined ? {} : { initialComment: text }),
    });
    return { fileId, name, size: bytes.byteLength };
  }

  /** Changes the cache, calls Slack, and puts the cached message back as it was when Slack refuses. */
  async #optimistic(
    channelId: string,
    before: HistoryMessage,
    change: () => void,
    call: () => Promise<void>,
  ): Promise<void> {
    const { store, connectionId, onChanged } = this.#options;
    change();
    onChanged(channelId);
    try {
      await call();
    } catch (error) {
      store.upsertMessage(connectionId, channelId, before);
      onChanged(channelId);
      throw error;
    }
  }

  #cached(channelId: string, ts: string): HistoryMessage | null {
    return this.#options.store.thread(this.#options.connectionId, channelId, ts).parent;
  }

  /** The cached message, only when the person wrote it. Checked before any Slack call. */
  #ownMessage(channelId: string, ts: string, owner: string): HistoryMessage {
    const message = this.#cached(channelId, ts);
    if (!message || message.deleted || message.authorId !== owner)
      throw new Error(sourceText("error.messaging.clientNotYours"));
    return message;
  }

  #owner(): string {
    if (!this.#options.adapter()) throw new Error(sourceText("error.messaging.notConnected"));
    const owner = this.#options.ownerUserId();
    if (!owner) throw new Error(sourceText("error.messaging.clientNeedsUser"));
    return owner;
  }

  #adapter(): Partial<SlackClientActionAdapter> {
    const adapter = this.#options.adapter();
    if (!adapter) throw new Error(sourceText("error.messaging.notConnected"));
    return adapter;
  }
}

function unsupported(): Error {
  return new Error(sourceText("error.messaging.unsupported"));
}

function checkText(text: string): void {
  if (!text.trim()) throw new Error(sourceText("error.messaging.sendTextEmpty"));
  if (text.length > SLACK_CLIENT_LIMITS.textLength)
    throw new Error(sourceText("error.messaging.clientTextTooLong", { limit: SLACK_CLIENT_LIMITS.textLength }));
}

function tooLarge(): Error {
  return new Error(
    sourceText("error.messaging.clientFileTooLarge", { limit: SLACK_CLIENT_LIMITS.uploadBytes / MEGABYTE }),
  );
}

async function readSource(source: SlackClientUploadSource): Promise<{ name: string; bytes: Uint8Array }> {
  if ("bytes" in source) {
    if (source.bytes.byteLength > SLACK_CLIENT_LIMITS.uploadBytes) throw tooLarge();
    return source;
  }
  // The size is checked before the read, so a large file is never held in memory.
  if ((await stat(source.path)).size > SLACK_CLIENT_LIMITS.uploadBytes) throw tooLarge();
  const bytes = new Uint8Array(await readFile(source.path));
  // The file can grow between the two reads.
  if (bytes.byteLength > SLACK_CLIENT_LIMITS.uploadBytes) throw tooLarge();
  return { name: basename(source.path), bytes };
}
