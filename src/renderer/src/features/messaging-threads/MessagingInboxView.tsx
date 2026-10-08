import type { MessagingInboxMessage } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { SlackInboxList, slackInboxKey } from "@openbot/ui/features/messaging/SlackInboxList";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { formatMessageTime } from "../../app-message-projection";
import { useAgents } from "../agents/agents-context";
import { MessagingInboxReply } from "./MessagingInboxReply";
import { useMessagingThreads } from "./messaging-threads-context";
import { messagingThreadsPort } from "./messaging-threads-port";

/**
 * The person's local Slack inbox: the conversations on the left, the messages of the open one on the
 * right, and a box that replies as the person. Reading a conversation marks it read for GoAhead. Every
 * inbox workspace is connected as the person, so each one can send the reply.
 */
export function MessagingInboxView() {
  const { t } = useText();
  const threads = useMessagingThreads();
  const { agentList } = useAgents();
  const items = createMemo(() =>
    threads.inbox.workspaces.flatMap((workspace) =>
      workspace.conversations.map((conversation) => ({ ...conversation, workspaceId: workspace.workspaceId })),
    ),
  );
  const activeKey = () => {
    const selection = threads.inbox.selection;
    return selection ? slackInboxKey(selection.workspaceId, selection.conversation) : null;
  };
  // A face and a name start each run of messages by one author.
  const runStarts = createMemo(() => {
    const messages = threads.inbox.page?.messages ?? [];
    return new Set(
      messages.filter((message, index) => messages[index - 1]?.from !== message.from).map((message) => message.id),
    );
  });
  const row = (message: MessagingInboxMessage) => ({
    id: message.id,
    author: message.isOwn ? ("you" as const) : ("agent" as const),
    body: message.text,
    time: formatMessageTime(message.sentAt),
    createdAt: message.sentAt,
  });
  return (
    <main class="conversation-panel" aria-label={t("messaging.inbox.title")}>
      <header class="window-drag conversation-header">
        <div class="conversation-heading-group">
          <span class="channel-header-copy">
            <h1>{t("messaging.inbox.title")}</h1>
            <Show when={threads.inbox.page?.place}>
              {(place) => <span class="channel-header-title">{place()}</span>}
            </Show>
          </span>
        </div>
      </header>
      <div class="slack-inbox-layout">
        <Show when={items().length > 0} fallback={<p class="slack-inbox-note">{t("messaging.inbox.empty")}</p>}>
          <SlackInboxList items={items()} activeKey={activeKey()} onSelect={threads.selectInboxConversation} />
        </Show>
        <section class="slack-inbox-messages conversation-scroll" aria-label={t("messaging.inbox.messages")}>
          <Show when={threads.inbox.failed}>
            <p role="alert" class="slack-inbox-note">
              {t("messaging.inbox.loadFailed")}
              <Button variant="ghost" onClick={threads.retryInbox}>
                {t("common.retry")}
              </Button>
            </p>
          </Show>
          <Show when={!threads.inbox.selection && items().length > 0}>
            <p class="slack-inbox-note">{t("messaging.inbox.choose")}</p>
          </Show>
          <div class="messaging-thread-messages">
            <For each={threads.inbox.page?.messages ?? []} keyed={(message) => message.id}>
              {(message) => {
                const first = () => runStarts().has(message().id);
                return (
                  <ChatMessageRow
                    message={row(message())}
                    author={
                      message().isOwn
                        ? { kind: "you", name: message().from }
                        : { kind: "agent", name: message().from, avatarSeed: message().from }
                    }
                    showAuthor={first()}
                    showTime={first()}
                    agents={agentList()}
                    onSelectAgent={() => undefined}
                    onOpenLink={(url) => void messagingThreadsPort().openUrl(url)}
                    onPreview={() => undefined}
                    onAttachmentAction={() => undefined}
                  />
                );
              }}
            </For>
          </div>
          {/* A new conversation starts with an empty box. With no open conversation, the "choose" note above is enough. */}
          <Show keyed when={activeKey()}>
            <MessagingInboxReply onSend={threads.sendInboxReply} />
          </Show>
        </section>
      </div>
    </main>
  );
}
