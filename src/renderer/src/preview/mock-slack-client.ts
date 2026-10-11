import {
  SLACK_CLIENT_LIMITS,
  type SlackClientChanged,
  type SlackClientConversation,
  type SlackClientDesktopApi,
  type SlackClientMessage,
  type SlackClientPage,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

/** The preview's Slack workspace, the same one the messaging mock connects as the person. */
const WORKSPACE_ID = "T0PREVIEW";
const ME = "U0PREVIEWME";
const PEOPLE: Record<string, string> = { [ME]: "You", U0PREET: "Preet", U0ANA: "Ana", U0SAM: "Sam" };
const CHANNELS: Record<string, string> = { C0GENERAL: "general", C0RELEASE: "release", G0PLANS: "plans" };
/** The preview's page size, small so that "Load older messages" shows. */
const PAGE = 20;
const MB = 1024 * 1024;

interface MockConversation {
  conversation: SlackClientConversation;
  /** Every message of the conversation, top level and replies, oldest first. */
  messages: SlackClientMessage[];
}

function ts(minutesAgo: number, sequence = 0): string {
  return `${Math.floor(Date.now() / 1000) - minutesAgo * 60}.${String(sequence).padStart(6, "0")}`;
}

function message(
  at: string,
  authorId: string,
  text: string,
  extra: Partial<Omit<SlackClientMessage, "ts" | "authorId" | "text" | "mine">> = {},
): SlackClientMessage {
  return {
    ts: at,
    threadTs: null,
    replyCount: 0,
    latestReplyTs: null,
    authorId,
    text,
    files: [],
    reactions: [],
    editedAt: null,
    deleted: false,
    ...extra,
    mine: authorId === ME,
  };
}

function previewConversations(): MockConversation[] {
  const conversation = (
    channelId: string,
    kind: SlackClientConversation["kind"],
    name: string,
    memberIds: string[],
    unreadCount: number,
    messages: SlackClientMessage[],
  ): MockConversation => ({
    conversation: {
      workspaceId: WORKSPACE_ID,
      channelId,
      kind,
      name,
      memberIds,
      unreadCount,
      lastActivityTs: messages.at(-1)?.ts ?? null,
      isMember: true,
    },
    messages,
  });
  const parent = ts(90);
  const history = Array.from({ length: 45 }, (_, index) =>
    message(ts(3_000 - index * 60, index), index % 3 === 0 ? ME : "U0SAM", `Release note ${index + 1}.`),
  );
  return [
    conversation("C0GENERAL", "channel", "general", [], 2, [
      message(parent, "U0PREET", "Why did the deploy fail?", {
        replyCount: 2,
        latestReplyTs: ts(80),
        reactions: [{ name: "eyes", count: 2, mine: true }],
      }),
      message(ts(85), ME, "The build step ran out of disk space.", { threadTs: parent }),
      message(ts(80), "U0PREET", "Thanks. Is it fixed?", { threadTs: parent }),
      message(ts(30), "U0ANA", "Demo is on Friday at 10:00. <@U0PREVIEWME> can you join?", {
        reactions: [{ name: "+1", count: 1, mine: false }],
      }),
      message(ts(5), ME, "Yes, I can join.", { editedAt: new Date(Date.now() - 4 * 60_000).toISOString() }),
    ]),
    conversation("C0RELEASE", "channel", "release", [], 0, history),
    conversation("G0PLANS", "private", "plans", [], 0, [
      message(ts(600), "U0SAM", "Plan for next week is in <#C0RELEASE>."),
    ]),
    conversation("D0PREET", "im", "Preet", ["U0PREET"], 1, [
      message(ts(120), ME, "Can you send me the release notes?"),
      message(ts(10), "U0PREET", "Here they are. The draft is in the shared folder."),
      // The preview puts this conversation on the auto-reply list: the agent's answer went out with no approval.
      message(ts(8), ME, "Thanks, I will read them today.", { autoSent: true }),
    ]),
    conversation("M0GROUP", "mpim", "Ana, Sam", ["U0ANA", "U0SAM"], 0, [message(ts(2_000), "U0ANA", "Lunch?")]),
  ];
}

function isTopLevel(candidate: SlackClientMessage): boolean {
  return candidate.threadTs === null || candidate.threadTs === candidate.ts;
}

/** The preview's Slack client: the conversations of the messaging mock's workspace, in memory. */
export function createMockSlackClient(): SlackClientDesktopApi {
  const conversations = previewConversations();
  const listeners = new Set<(change: SlackClientChanged) => void>();
  /** The conversations on the auto-reply list. */
  const autoReply = new Set<string>(["D0PREET"]);
  let uploads = 0;

  const changed = (channelId: string | null) => {
    for (const listener of listeners) listener(clone({ workspaceId: WORKSPACE_ID, channelId }));
  };
  const find = (workspaceId: string, channelId: string): MockConversation => {
    if (workspaceId !== WORKSPACE_ID) throw new Error(sourceText("error.messaging.clientNeedsUser"));
    const found = conversations.find((candidate) => candidate.conversation.channelId === channelId);
    if (!found) throw new Error(sourceText("error.messaging.threadUnavailable"));
    return found;
  };
  const findMessage = (workspaceId: string, channelId: string, at: string) => {
    const found = find(workspaceId, channelId).messages.find((candidate) => candidate.ts === at);
    if (!found) throw new Error(sourceText("error.messaging.threadUnavailable"));
    return found;
  };
  /** Adds the person's message, as Slack's echo does in the real cache, and counts a reply on its parent. */
  const post = (found: MockConversation, sent: SlackClientMessage) => {
    found.messages.push(sent);
    const parent = sent.threadTs ? found.messages.find((candidate) => candidate.ts === sent.threadTs) : undefined;
    if (parent) {
      parent.replyCount += 1;
      parent.latestReplyTs = sent.ts;
    }
    found.conversation.lastActivityTs = sent.ts;
  };
  /** The preview shares a file as a message, with the text when there is one, as the real upload does. */
  const share = (
    input: { workspaceId: string; channelId: string; threadTs?: string; text?: string },
    name: string,
    size: number,
  ) => {
    if (size > SLACK_CLIENT_LIMITS.uploadBytes)
      throw new Error(
        sourceText("error.messaging.clientFileTooLarge", { limit: SLACK_CLIENT_LIMITS.uploadBytes / MB }),
      );
    if (input.text?.trim()) checkText(input.text);
    const found = find(input.workspaceId, input.channelId);
    uploads += 1;
    const fileId = `F0PREVIEW${uploads}`;
    post(
      found,
      message(ts(0, found.messages.length + 1), ME, input.text?.trim() ?? "", {
        threadTs: input.threadTs ?? null,
        files: [{ id: fileId, name, mimetype: "application/octet-stream", size, previewUrl: null, permalink: null }],
      }),
    );
    changed(input.channelId);
    return { fileId, name, size };
  };
  const page = (found: MockConversation, beforeTs?: string): SlackClientPage => {
    const topLevel = found.messages.filter(
      (candidate) => isTopLevel(candidate) && (beforeTs === undefined || candidate.ts < beforeTs),
    );
    const messages = topLevel.slice(-PAGE);
    return clone({
      workspaceId: WORKSPACE_ID,
      channelId: found.conversation.channelId,
      messages,
      hasOlder: topLevel.length > messages.length,
      people: PEOPLE,
      channels: CHANNELS,
      customEmoji: {},
      offline: false,
      autoReply: autoReply.has(found.conversation.channelId),
    });
  };
  const checkText = (text: string) => {
    if (!text.trim()) throw new Error(sourceText("error.messaging.sendTextEmpty"));
    if (text.length > SLACK_CLIENT_LIMITS.textLength)
      throw new Error(sourceText("error.messaging.clientTextTooLong", { limit: SLACK_CLIENT_LIMITS.textLength }));
  };

  return {
    listConversations: async ({ workspaceId }) => {
      if (workspaceId !== WORKSPACE_ID) throw new Error(sourceText("error.messaging.clientNeedsUser"));
      return clone(
        conversations
          .map((candidate) => candidate.conversation)
          .sort((a, b) => (b.lastActivityTs ?? "").localeCompare(a.lastActivityTs ?? "")),
      );
    },
    open: async ({ workspaceId, channelId }) => {
      const found = find(workspaceId, channelId);
      found.conversation.unreadCount = 0;
      return page(found);
    },
    older: async ({ workspaceId, channelId, beforeTs }) => page(find(workspaceId, channelId), beforeTs),
    thread: async ({ workspaceId, channelId, threadTs }) => {
      const found = find(workspaceId, channelId);
      const parent = found.messages.find((candidate) => candidate.ts === threadTs);
      if (!parent) throw new Error(sourceText("error.messaging.threadUnavailable"));
      return clone({
        workspaceId,
        channelId,
        parent,
        replies: found.messages.filter((candidate) => candidate.threadTs === threadTs && candidate.ts !== threadTs),
        people: PEOPLE,
        channels: CHANNELS,
        customEmoji: {},
      });
    },
    send: async ({ workspaceId, channelId, text, threadTs, broadcast }) => {
      checkText(text);
      const found = find(workspaceId, channelId);
      const sent = message(ts(0, found.messages.length + 1), ME, text.trim(), { threadTs: threadTs ?? null });
      post(found, sent);
      if (threadTs && broadcast) found.messages.push({ ...sent, ts: ts(0, found.messages.length + 1), threadTs: null });
      changed(channelId);
    },
    edit: async ({ workspaceId, channelId, ts: at, text }) => {
      checkText(text);
      const found = findMessage(workspaceId, channelId, at);
      if (!found.mine || found.deleted) throw new Error(sourceText("error.messaging.clientNotYours"));
      found.text = text.trim();
      found.editedAt = new Date().toISOString();
      changed(channelId);
    },
    delete: async ({ workspaceId, channelId, ts: at }) => {
      const found = findMessage(workspaceId, channelId, at);
      if (!found.mine || found.deleted) throw new Error(sourceText("error.messaging.clientNotYours"));
      // As the real cache: a parent with replies stays as deleted, so its replies keep a parent.
      if (found.replyCount > 0) {
        found.deleted = true;
        found.text = "";
        found.files = [];
        found.reactions = [];
      } else {
        const conversation = find(workspaceId, channelId);
        conversation.messages = conversation.messages.filter((candidate) => candidate.ts !== at);
        const parent =
          found.threadTs && found.threadTs !== at
            ? conversation.messages.find((candidate) => candidate.ts === found.threadTs)
            : undefined;
        if (parent) {
          parent.replyCount = Math.max(parent.replyCount - 1, 0);
          parent.latestReplyTs =
            conversation.messages
              .filter((candidate) => candidate.threadTs === parent.ts && candidate.ts !== parent.ts)
              .at(-1)?.ts ?? null;
        }
      }
      changed(channelId);
    },
    react: async ({ workspaceId, channelId, ts: at, name, on }) => {
      const found = findMessage(workspaceId, channelId, at);
      const current = found.reactions.find((reaction) => reaction.name === name);
      if (on && !current?.mine) {
        if (current) {
          current.count += 1;
          current.mine = true;
        } else found.reactions.push({ name, count: 1, mine: true });
      } else if (!on && current?.mine) {
        current.count -= 1;
        current.mine = false;
        if (current.count === 0) found.reactions = found.reactions.filter((reaction) => reaction !== current);
      }
      changed(channelId);
    },
    setAutoReply: async ({ workspaceId, channelId, on }) => {
      find(workspaceId, channelId);
      if (on) autoReply.add(channelId);
      else autoReply.delete(channelId);
      changed(channelId);
    },
    // The preview has no file picker: each upload is the same small file.
    upload: async (input) => share(input, "preview.txt", 12),
    uploadBytes: async (input) => share(input, input.name, input.bytes.byteLength),
    mentionCandidates: async ({ workspaceId, query }) => {
      if (workspaceId !== WORKSPACE_ID) throw new Error(sourceText("error.messaging.clientNeedsUser"));
      const wanted = query.trim().toLowerCase();
      return Object.entries(PEOPLE)
        .filter(([id, name]) => id !== ME && name.toLowerCase().includes(wanted))
        .map(([id, name]) => ({ id, name }));
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
