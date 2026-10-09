/**
 * The right pane of the Slack client: one thread, its replies and a composer that replies in it. The
 * view around it holds the complementary landmark.
 *
 * Each message is the same row as in the message pane: author, text, files, reactions, "edited", and
 * Edit and Delete for the person's own messages. A deleted message shows no content. The reply
 * composer offers "Also send to channel".
 */

import type { SlackClientMessage } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { SlackComposer } from "./SlackComposer";
import { SlackMessageItem } from "./SlackMessagePane";
import type {
  SlackClientLookups,
  SlackClientUpload,
  SlackComposerActions,
  SlackMessageActions,
} from "./slack-client-types";

export interface SlackThreadPanelProps extends SlackMessageActions {
  /** The message the thread starts from. Null while the first read is on its way. */
  parent: SlackClientMessage | null;
  /** Replies, oldest first, with the person's actions that Slack has not confirmed. */
  replies: SlackClientMessage[];
  lookups: SlackClientLookups;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onClose: () => void;
  /** Bound to this thread: a send replies in it. */
  composer: SlackComposerActions;
  /** Uploads on their way into this thread. */
  uploads: SlackClientUpload[];
}

export function SlackThreadPanel(props: SlackThreadPanelProps) {
  const { t } = useText();
  const row = (message: () => SlackClientMessage) => (
    <SlackMessageItem
      message={message()}
      grouped={false}
      lookups={props.lookups}
      onEdit={props.onEdit}
      onDelete={props.onDelete}
      onReact={props.onReact}
      onOpenLink={props.onOpenLink}
    />
  );
  return (
    <div class="slack-thread-panel" aria-busy={props.loading ? "true" : "false"}>
      <header class="slack-thread-panel-header">
        <h2>{t("messaging.client.thread.title")}</h2>
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          {t("messaging.client.thread.close")}
        </Button>
      </header>
      <Show when={props.failed}>
        <p role="alert" class="slack-client-note">
          {t("messaging.inbox.loadFailed")}
          <Button variant="ghost" onClick={props.onRetry}>
            {t("common.retry")}
          </Button>
        </p>
      </Show>
      <div class="slack-thread-body">
        <Show when={props.parent}>{(parent) => row(parent)}</Show>
        <ol class="slack-thread-replies">
          <For each={props.replies} keyed={(message) => message.ts}>
            {(message) => <li>{row(message)}</li>}
          </For>
        </ol>
      </div>
      <SlackComposer {...props.composer} inThread uploads={props.uploads} customEmoji={props.lookups.customEmoji} />
    </div>
  );
}
