// The Slack client payloads. No message here quotes the input.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  SLACK_CLIENT_LIMITS,
  type SlackClientDeleteInput,
  type SlackClientEditInput,
  type SlackClientListInput,
  type SlackClientMentionInput,
  type SlackClientOlderInput,
  type SlackClientOpenInput,
  type SlackClientReactInput,
  type SlackClientSendInput,
  type SlackClientThreadInput,
  type SlackClientUploadBytesInput,
  type SlackClientUploadInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { isObject, requireString } from "./validation";

/** A Slack message `ts`: seconds, a dot, and a sequence. */
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/u;
/** A Slack emoji name, as `reactions.add` takes it: no colons, and a skin tone after `::`. */
const EMOJI_NAME = /^[\p{L}\p{N}_+'-]+(?:::skin-tone-[2-6])?$/u;
const EMOJI_NAME_LENGTH = 100;
const MENTION_QUERY_LENGTH = 80;
const FILE_NAME_LENGTH = 255;
const MEGABYTE = 1024 * 1024;

function invalid(): Error {
  return new Error("A Slack client request is invalid.");
}

function record(value: unknown) {
  if (!isObject(value)) throw invalid();
  return value;
}

function workspaceId(value: unknown): string {
  return requireString(value, "Workspace id");
}

function channelId(value: unknown): string {
  return requireString(value, "Conversation", INPUT_LIMITS.identifier);
}

function slackTs(value: unknown, field: string): string {
  const ts = requireString(value, field, 32);
  if (!SLACK_TS.test(ts)) throw invalid();
  return ts;
}

/** Untrimmed: the action trims, and refuses an empty or too long text with a text the person reads. */
function messageText(value: unknown): string {
  return requireString(value, "Text", INPUT_LIMITS.messageText);
}

export function parseSlackClientListInput(value: unknown): SlackClientListInput {
  const input = record(value);
  return { workspaceId: workspaceId(input.workspaceId) };
}

export function parseSlackClientOpenInput(value: unknown): SlackClientOpenInput {
  const input = record(value);
  return { workspaceId: workspaceId(input.workspaceId), channelId: channelId(input.channelId) };
}

export function parseSlackClientOlderInput(value: unknown): SlackClientOlderInput {
  const input = record(value);
  return {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    beforeTs: slackTs(input.beforeTs, "Before"),
  };
}

export function parseSlackClientThreadInput(value: unknown): SlackClientThreadInput {
  const input = record(value);
  return {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    threadTs: slackTs(input.threadTs, "Thread"),
  };
}

export function parseSlackClientSendInput(value: unknown): SlackClientSendInput {
  const input = record(value);
  const result: SlackClientSendInput = {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    text: messageText(input.text),
  };
  if (input.threadTs !== undefined) result.threadTs = slackTs(input.threadTs, "Thread");
  if (input.broadcast !== undefined) {
    if (!isBoolean(input.broadcast)) throw invalid();
    result.broadcast = input.broadcast;
  }
  // A file goes with an upload, which takes the text. A field this endpoint would ignore is refused.
  if (input.fileIds !== undefined) throw invalid();
  return result;
}

export function parseSlackClientEditInput(value: unknown): SlackClientEditInput {
  const input = record(value);
  return {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    ts: slackTs(input.ts, "Message"),
    text: messageText(input.text),
  };
}

export function parseSlackClientDeleteInput(value: unknown): SlackClientDeleteInput {
  const input = record(value);
  return {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    ts: slackTs(input.ts, "Message"),
  };
}

export function parseSlackClientReactInput(value: unknown): SlackClientReactInput {
  const input = record(value);
  const name = requireString(input.name, "Emoji", EMOJI_NAME_LENGTH);
  if (!EMOJI_NAME.test(name) || !isBoolean(input.on)) throw invalid();
  return {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
    ts: slackTs(input.ts, "Message"),
    name,
    on: input.on,
  };
}

export function parseSlackClientUploadInput(value: unknown): SlackClientUploadInput {
  return uploadInput(record(value));
}

/** A dropped file: its name and bytes, never a path. The size is checked before anything reads the bytes. */
export function parseSlackClientUploadBytesInput(value: unknown): SlackClientUploadBytesInput {
  const input = record(value);
  if (!(input.bytes instanceof Uint8Array)) throw invalid();
  if (input.bytes.byteLength > SLACK_CLIENT_LIMITS.uploadBytes)
    throw new Error(
      sourceText("error.messaging.clientFileTooLarge", { limit: SLACK_CLIENT_LIMITS.uploadBytes / MEGABYTE }),
    );
  const name = requireString(input.name, "File name", FILE_NAME_LENGTH);
  // A name only: no folder and no control character.
  if (!name.trim() || /[\\/\p{Cc}]/u.test(name)) throw invalid();
  return { ...uploadInput(input), name, bytes: input.bytes };
}

function uploadInput(input: DynamicRecord): SlackClientUploadInput {
  const result: SlackClientUploadInput = {
    workspaceId: workspaceId(input.workspaceId),
    channelId: channelId(input.channelId),
  };
  if (input.threadTs !== undefined) result.threadTs = slackTs(input.threadTs, "Thread");
  if (input.text !== undefined) result.text = messageText(input.text);
  return result;
}

export function parseSlackClientMentionInput(value: unknown): SlackClientMentionInput {
  const input = record(value);
  // An empty query is valid: the person typed only `@`.
  if (!isString(input.query) || input.query.length > MENTION_QUERY_LENGTH) throw invalid();
  return { workspaceId: workspaceId(input.workspaceId), query: input.query };
}
