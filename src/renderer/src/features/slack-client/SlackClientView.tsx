import { SlackComposer } from "@openbot/ui/features/slack-client/SlackComposer";
import { SlackConversationList } from "@openbot/ui/features/slack-client/SlackConversationList";
import { SlackMessagePane } from "@openbot/ui/features/slack-client/SlackMessagePane";
import { SlackThreadPanel } from "@openbot/ui/features/slack-client/SlackThreadPanel";
import { type SlackComposerActions, slackClientKey } from "@openbot/ui/features/slack-client/slack-client-types";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { useNavigation } from "../../navigation";
import { useMessagingThreads } from "../messaging-threads/messaging-threads-context";
import { SlackClientProvider, useSlackClient } from "./slack-client-context";

/**
 * The Slack client behind the "Slack inbox" row: the person's conversations on the left, the open one
 * in the middle with its composer, and the open thread on the right. The panes come from
 * `@openbot/ui`; this view binds them to the store.
 */
export function SlackClientView() {
  return (
    <SlackClientProvider>
      <SlackClientLayout />
    </SlackClientProvider>
  );
}

function SlackClientLayout() {
  const { t } = useText();
  const client = useSlackClient();
  const messagingThreads = useMessagingThreads();
  const { selectAgent } = useNavigation();
  const activeKey = () => {
    const place = client.state.selection;
    return place ? slackClientKey(place.workspaceId, place.channelId) : null;
  };
  const lookups = () => client.page() ?? { people: {}, channels: {}, customEmoji: {} };
  const threadLookups = () => client.thread() ?? lookups();
  const messageActions = {
    onEdit: client.edit,
    onDelete: client.remove,
    onReact: client.react,
    onOpenLink: client.openUrl,
  };
  // An `@chief` instruction opens the orchestrator's conversation, where its answer arrives.
  const composerFor = (threadTs: () => string | null): SlackComposerActions => ({
    onSend: ({ text, broadcast }) => {
      const thread = threadTs();
      return client.send({
        text,
        ...(thread === null ? {} : { threadTs: thread, ...(broadcast === undefined ? {} : { broadcast }) }),
      });
    },
    onAsk: async (text) => selectAgent(await client.askOrchestrator(text)),
    onMentionSearch: client.mentionCandidates,
    onAttach: (text) => client.attach(threadTs(), text),
    onDropFile: (file, text) => client.uploadFile(file, threadTs(), text),
  });
  const channelComposer = composerFor(() => null);
  const threadComposer = composerFor(() => client.state.thread?.threadTs ?? null);

  return (
    <main class="conversation-panel" aria-label={t("messaging.inbox.title")}>
      <header class="window-drag conversation-header">
        <div class="conversation-heading-group">
          <span class="channel-header-copy">
            <h1>{t("messaging.inbox.title")}</h1>
          </span>
        </div>
      </header>
      <Show when={client.state.actionError}>
        {(error) => (
          <p role="alert" class="slack-client-note">
            {error()}
          </p>
        )}
      </Show>
      <div class={["slack-client-layout", { "slack-client-layout-thread": client.state.thread !== null }]}>
        <nav class="slack-client-conversations" aria-label={t("messaging.inbox.conversations")}>
          <SlackConversationList
            conversations={client.state.conversations}
            workspaces={messagingThreads.inbox.workspaces}
            activeKey={activeKey()}
            onSelect={client.select}
          />
        </nav>
        <section class="slack-client-messages" aria-label={t("messaging.inbox.messages")}>
          <SlackMessagePane
            {...messageActions}
            conversation={client.conversation()}
            messages={client.messages()}
            lookups={lookups()}
            hasOlder={client.page()?.hasOlder ?? false}
            offline={client.page()?.offline ?? false}
            loadError={client.page()?.loadError ?? false}
            loading={client.loading()}
            loadingOlder={client.state.loadingOlder}
            failed={client.state.pageFailed}
            onRetry={client.retry}
            onLoadOlder={client.loadOlder}
            onOpenThread={client.openThread}
            autoReply={client.page()?.autoReply ?? false}
            onAutoReplyChange={client.setAutoReply}
          />
          {/* A new conversation starts with an empty composer. */}
          <Show keyed when={activeKey()}>
            <SlackComposer {...channelComposer} uploads={client.uploadsIn(null)} customEmoji={lookups().customEmoji} />
          </Show>
        </section>
        <Show keyed when={client.state.thread?.threadTs}>
          {(threadTs) => (
            <aside class="slack-client-thread" aria-label={t("messaging.client.thread.title")}>
              <SlackThreadPanel
                {...messageActions}
                parent={client.threadParent()}
                replies={client.threadReplies()}
                lookups={threadLookups()}
                loading={client.thread() === null && !client.state.threadFailed}
                failed={client.state.threadFailed}
                onRetry={client.retryThread}
                onClose={client.closeThread}
                composer={threadComposer}
                uploads={client.uploadsIn(threadTs)}
              />
            </aside>
          )}
        </Show>
      </div>
    </main>
  );
}
