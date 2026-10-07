import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Button, Hash, MessageCircle } from "@openbot/ui";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { useText } from "@openbot/ui/text";
import { createMemo, For, Show } from "solid-js";
import { toAgentMessages } from "../../app-message-projection";
import { useNavigation } from "../../navigation";
import { useAgents } from "../agents/agents-context";
import { useMessagingThreads } from "./messaging-threads-context";
import { messagingThreadsPort } from "./messaging-threads-port";

/**
 * One Slack conversation that an agent answers, read-only: the Slack messages and the agent's
 * answers, with no composer. The agent's work notes stay out, as in Slack.
 */
export function MessagingThreadConversation() {
  const { t } = useText();
  const threads = useMessagingThreads();
  const { agentList } = useAgents();
  const { selectAgent } = useNavigation();
  const thread = () => threads.selectedThread();
  const agent = createMemo(() => agentList().find((candidate) => candidate.id === thread()?.agentId));
  const messages = createMemo(() => {
    const page = threads.state.page;
    if (!page) return [];
    return toAgentMessages(page.messages, page.agentId).filter((message) => message.kind !== "thinking");
  });
  // A face and a name start each run of messages by one side.
  const runStarts = createMemo(() => {
    const starts = new Set<string>();
    messages().forEach((message, index) => {
      if (messages()[index - 1]?.author !== message.author) starts.add(message.id);
    });
    return starts;
  });
  // The thread does not keep who wrote each Slack message. A direct message has one person, its title.
  const author = (own: boolean): ChatMessageAuthor => {
    if (!own) return { kind: "agent", name: agent()?.name ?? "", agent: agent(), avatarSeed: thread()?.agentId };
    const current = thread();
    return { kind: "member", name: current?.isDirect ? current.title : t("messaging.thread.slackPerson") };
  };
  const openAttachment = (attachment: AttachmentSummary, action: "open" | "reveal" | "download" = "open") => {
    void messagingThreadsPort()
      .openAttachment({ attachmentId: attachment.id, action })
      .catch(() => undefined);
  };
  const openAgent = (agentId: string) => {
    threads.close();
    selectAgent(agentId);
  };
  return (
    <main class="conversation-panel" aria-label={t("messaging.thread.label", { title: thread()?.title ?? "" })}>
      <header class="window-drag conversation-header">
        <div class="conversation-heading-group messaging-thread-heading">
          <span class="messaging-thread-icon" aria-hidden="true">
            <Show when={thread()?.isDirect} fallback={<Hash />}>
              <MessageCircle />
            </Show>
          </span>
          <span class="channel-header-copy">
            <h1>{thread()?.title}</h1>
            <Show when={agent()}>{(current) => <span class="channel-header-title">{current().name}</span>}</Show>
          </span>
        </div>
      </header>
      <Show when={threads.state.failed}>
        <p role="alert">
          {t("messaging.thread.loadFailed")}
          <Button variant="ghost" onClick={threads.retry}>
            {t("common.retry")}
          </Button>
        </p>
      </Show>
      <section class="conversation-scroll" aria-label={t("channel.conversation.messages")} aria-live="polite">
        <Show when={threads.state.page?.pageInfo.hasOlder}>
          <Button variant="ghost" disabled={threads.state.loading} onClick={threads.loadOlder}>
            {t("channel.conversation.loadOlder")}
          </Button>
        </Show>
        <Show when={threads.state.page && messages().length === 0}>
          <p class="messaging-thread-empty">{t("messaging.thread.empty")}</p>
        </Show>
        <div class="messaging-thread-messages">
          <For each={messages()} keyed={(message) => message.id}>
            {(message) => {
              const own = () => message().author === "you";
              const firstOfRun = () => runStarts().has(message().id);
              return (
                <ChatMessageRow
                  message={message()}
                  author={author(own())}
                  showAuthor={firstOfRun()}
                  showTime={firstOfRun()}
                  agents={agentList()}
                  onSelectAgent={openAgent}
                  onOpenLink={(url) => void messagingThreadsPort().openUrl(url)}
                  onPreview={(attachment) => openAttachment(attachment)}
                  onAttachmentAction={openAttachment}
                  onDownload={(attachment) => openAttachment(attachment, "download")}
                />
              );
            }}
          </For>
        </div>
      </section>
      <p class="messaging-thread-readonly" role="note">
        {t("messaging.thread.readOnly")}
      </p>
    </main>
  );
}
