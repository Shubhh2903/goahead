/**
 * The props that the panes of the Slack client share. The desktop renderer owns the store and binds
 * these actions; the panes only show data and call back.
 */

import type { SlackClientMentionCandidate } from "@openbot/contracts/ipc";

/** The key of one conversation in a list: `workspaceId:channelId`. */
export function slackClientKey(workspaceId: string, channelId: string): string {
  return `${workspaceId}:${channelId}`;
}

/** The names that a message text needs. An id that is not here shows as it is. */
export interface SlackClientLookups {
  people: Readonly<Record<string, string>>;
  channels: Readonly<Record<string, string>>;
  customEmoji: Readonly<Record<string, string>>;
}

/**
 * What a person can do to one message. Each action shows at once; the promise rejects when Slack
 * refuses it, after the store has rolled the message back and shown the error text.
 */
export interface SlackMessageActions {
  onEdit: (ts: string, text: string) => Promise<void>;
  onDelete: (ts: string) => Promise<void>;
  onReact: (ts: string, name: string, on: boolean) => Promise<void>;
  onOpenLink: (url: string) => void;
}

/** A file the person dropped on a composer. The renderer reads its bytes; main never gets a path. */
export interface SlackComposerFile {
  name: string;
  bytes: Uint8Array;
}

/** A file upload on its way to Slack. */
export interface SlackClientUpload {
  id: string;
  name: string;
}

/**
 * What a composer reaches. The store binds them to one conversation, or to one thread of it. Each
 * promise rejects when the action fails, so the composer can keep the text.
 */
export interface SlackComposerActions {
  onSend: (input: { text: string; broadcast?: boolean }) => Promise<void>;
  /** An `@chief …` text: asks the Slack Orchestrator. Nothing goes to Slack. */
  onAsk: (text: string) => Promise<void>;
  onMentionSearch: (query: string) => Promise<SlackClientMentionCandidate[]>;
  /** Main opens the file picker. The text goes with the file. */
  onAttach: (text?: string) => Promise<void>;
  onDropFile: (file: SlackComposerFile, text?: string) => Promise<void>;
}
