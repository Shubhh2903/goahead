import type { MessagingInboxMessage } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { SlackInboxList, slackInboxKey } from "@openbot/ui/features/messaging/SlackInboxList";
import { SlackMessageContent } from "@openbot/ui/features/messaging/SlackMessageContent";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js";
import { formatMessageTime } from "../../app-message-projection";
import { useNavigation } from "../../navigation";
import { useAgents } from "../agents/agents-context";
import { MessagingInboxReply } from "./MessagingInboxReply";
import { type MessagingInboxOutgoing, useMessagingThreads } from "./messaging-threads-context";
import { messagingThreadsPort } from "./messaging-threads-port";

/**
 * The person's local Slack inbox: the conversations on the left, the messages of the open one on the
 * right, and a box that replies as the person. Reading a conversation marks it read for GoAhead. Every
 * inbox workspace is connected as the person, so each one can send the reply.
 */
/** The view follows new messages only while the person is this close to the newest one. */
const STICK_DISTANCE = 80;

export function MessagingInboxView() {
  const { t } = useText();
  const threads = useMessagingThreads();
  const { agentList } = useAgents();
  const { selectAgent } = useNavigation();
  // An `@chief` instruction opens the orchestrator's conversation, where its answer arrives.
  const ask = async (text: string) => selectAgent(await threads.askOrchestratorAboutInbox(text));
  const items = createMemo(() =>
    threads.inbox.workspaces.flatMap((workspace) =>
      workspace.conversations.map((conversation) => ({ ...conversation, workspaceId: workspace.workspaceId })),
    ),
  );
  const activeKey = () => {
    const selection = threads.inbox.selection;
    return selection ? slackInboxKey(selection.workspaceId, selection.conversation) : null;
  };
  // The replies sent in the conversation on screen that no read has brought yet.
  const outgoing = createMemo(() => {
    const page = threads.inbox.page;
    if (!page) return [];
    return threads.inbox.outgoing.filter(
      (item) => item.workspaceId === page.workspaceId && item.conversation === page.conversation,
    );
  });
  const ownName = () =>
    threads.inbox.page?.messages.findLast((message) => message.isOwn)?.from ?? t("chat.message.you");
  // The page on screen is not the chosen conversation yet: its read is on the way.
  const loading = () => {
    const selection = threads.inbox.selection;
    const page = threads.inbox.page;
    return (
      selection !== null &&
      (page?.workspaceId !== selection.workspaceId || page.conversation !== selection.conversation)
    );
  };

  let messageList: HTMLElement | undefined;
  let stickToLatest = true;
  let shownKey: string | null = null;
  let scrollFrame: number | undefined;
  // A new conversation opens at its newest message. In the same conversation, a new message moves the
  // view only while the person is at the newest one, so reading older messages is not interrupted.
  createEffect(
    () => {
      const page = threads.inbox.page;
      return {
        key: page ? slackInboxKey(page.workspaceId, page.conversation) : null,
        latest: page?.messages.at(-1)?.id,
        count: (page?.messages.length ?? 0) + outgoing().length,
      };
    },
    ({ key }) => {
      if (key !== shownKey) {
        shownKey = key;
        stickToLatest = true;
      }
      if (!stickToLatest) return;
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = undefined;
        if (messageList) messageList.scrollTop = messageList.scrollHeight;
      });
    },
  );
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });

  // A face and a name start each run of messages by one author.
  const runStarts = createMemo(() => {
    const messages = threads.inbox.page?.messages ?? [];
    return new Set(
      messages.filter((message, index) => messages[index - 1]?.from !== message.from).map((message) => message.id),
    );
  });
  // The bubble's own body stays empty: the Slack text is drawn below it, from its mrkdwn.
  const row = (message: MessagingInboxMessage) => ({
    id: message.id,
    author: message.isOwn ? ("you" as const) : ("agent" as const),
    body: "",
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
        <section
          class="slack-inbox-messages conversation-scroll"
          aria-label={t("messaging.inbox.messages")}
          aria-busy={loading() ? "true" : "false"}
          ref={(element) => {
            messageList = element;
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            stickToLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_DISTANCE;
          }}
        >
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
                  >
                    <SlackMessageContent
                      text={message().text}
                      files={message().files}
                      people={threads.inbox.page?.people}
                      channels={threads.inbox.page?.channels}
                      customEmoji={threads.inbox.page?.customEmoji}
                      onOpenLink={(url) => void messagingThreadsPort().openUrl(url)}
                    />
                  </ChatMessageRow>
                );
              }}
            </For>
            <For each={outgoing()} keyed={(item) => item.id}>
              {(item) => <OutgoingRow item={item()} name={ownName()} />}
            </For>
          </div>
          {/* A new conversation starts with an empty box. With no open conversation, the "choose" note above is enough. */}
          <Show keyed when={activeKey()}>
            <MessagingInboxReply onSend={threads.sendInboxReply} onAsk={ask} />
          </Show>
        </section>
      </div>
    </main>
  );
}

/** A reply the person sent, before a read brings the stored message. It is muted while Slack has not answered. */
function OutgoingRow(props: { item: MessagingInboxOutgoing; name: string }) {
  const { t } = useText();
  const { agentList } = useAgents();
  return (
    <ChatMessageRow
      class={props.item.sending ? "messaging-inbox-message-sending" : undefined}
      message={{
        id: props.item.id,
        author: "you",
        body: props.item.text,
        time: formatMessageTime(props.item.startedAt),
        createdAt: props.item.startedAt,
      }}
      author={{ kind: "you", name: props.name }}
      showAuthor={false}
      showTime={false}
      agents={agentList()}
      footer={
        <Show when={props.item.sending}>
          <span class="messaging-inbox-sending-note">{t("common.sending")}</span>
        </Show>
      }
      onSelectAgent={() => undefined}
      onOpenLink={(url) => void messagingThreadsPort().openUrl(url)}
      onPreview={() => undefined}
      onAttachmentAction={() => undefined}
    />
  );
}
