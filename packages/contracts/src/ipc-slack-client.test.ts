import { describe, expect, it } from "vitest";
import {
  isSlackClientChanged,
  isSlackClientConversations,
  isSlackClientPage,
  isSlackClientThread,
  isSlackClientUploadResult,
  type SlackClientMessage,
  type SlackClientPage,
} from "./ipc-slack-client";

const message: SlackClientMessage = {
  ts: "1700000000.000100",
  threadTs: null,
  replyCount: 2,
  latestReplyTs: "1700000001.000100",
  authorId: "U1",
  text: "hello",
  files: [
    {
      id: "F1",
      name: "a.png",
      mimetype: "image/png",
      size: 10,
      previewUrl: "openbot-attachment://slack/T1/F1",
      permalink: "https://example.slack.com/files/F1",
    },
  ],
  reactions: [{ name: "thumbsup", count: 1, mine: true }],
  editedAt: null,
  deleted: false,
  mine: true,
};

const page: SlackClientPage = {
  workspaceId: "T1",
  channelId: "C1",
  messages: [message],
  hasOlder: true,
  people: { U1: "Ada" },
  channels: { C1: "general" },
  customEmoji: { party: "https://emoji.slack-edge.com/party.png" },
  offline: false,
};

describe("Slack client guards", () => {
  it("accepts a valid page and rejects a malformed one", () => {
    expect(isSlackClientPage(page)).toBe(true);
    expect(isSlackClientPage({ ...page, messages: [{ ...message, pending: "sending" }] })).toBe(true);
    expect(isSlackClientPage({ ...page, offline: "no" })).toBe(false);
    expect(isSlackClientPage({ ...page, messages: [{ ...message, ts: "" }] })).toBe(false);
    expect(isSlackClientPage({ ...page, messages: [{ ...message, pending: "other" }] })).toBe(false);
  });

  // A file URL that is not main's own scheme would let the renderer load a Slack URL with a token.
  it("rejects a file preview that is not main's Slack image scheme", () => {
    const file = { ...message.files[0], previewUrl: "https://files.slack.com/F1?t=xoxp-1" };
    expect(isSlackClientPage({ ...page, messages: [{ ...message, files: [file] }] })).toBe(false);
  });

  it("checks conversations, threads, uploads and change events", () => {
    const conversation = {
      workspaceId: "T1",
      channelId: "D1",
      kind: "im",
      name: "Ada",
      memberIds: ["U1"],
      unreadCount: 0,
      lastActivityTs: null,
      isMember: true,
    };
    expect(isSlackClientConversations([conversation])).toBe(true);
    expect(isSlackClientConversations([{ ...conversation, kind: "direct" }])).toBe(false);
    const { messages: _messages, hasOlder: _hasOlder, offline: _offline, ...lookups } = page;
    expect(isSlackClientThread({ ...lookups, parent: message, replies: [message] })).toBe(true);
    expect(isSlackClientThread({ ...lookups, parent: null, replies: [] })).toBe(false);
    expect(isSlackClientUploadResult({ fileId: "F1", name: "a.png", size: 10 })).toBe(true);
    expect(isSlackClientUploadResult({ fileId: "F1", name: "a.png", size: -1 })).toBe(false);
    expect(isSlackClientChanged({ workspaceId: "T1", channelId: null })).toBe(true);
    expect(isSlackClientChanged({ workspaceId: "T1" })).toBe(false);
  });
});
