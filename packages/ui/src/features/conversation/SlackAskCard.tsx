import type { ConversationSlackAsk } from "@openbot/contracts/ipc";
import { Button, ChevronDown, ExternalLink } from "@openbot/ui";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { SlackMark } from "../settings/IntegrationLayout";

export interface SlackAskCardProps {
  slackAsk: ConversationSlackAsk;
  /** The full text that the agent got. It shows only on request. */
  text: string;
  time: string;
  createdAt?: string | undefined;
  /** Opens the Slack conversation. Absent where the Slack client is not available. */
  onOpenConversation?: (() => void) | undefined;
}

const TITLE_KEYS = {
  "auto-reply": "chat.slackAsk.autoReply",
  "inbox-ask": "chat.slackAsk.inboxAsk",
  "auto-reply-paused": "chat.slackAsk.autoReplyPaused",
} as const;

/**
 * A message that GoAhead wrote to a Slack Orchestrator for the person, drawn short: the
 * conversation, the new messages or the person's instruction, and the full text on request. All of
 * it is plain text from Slack, never markup.
 */
export function SlackAskCard(props: SlackAskCardProps) {
  const { t } = useText();
  const [expanded, setExpanded] = createSignal(false);
  const contextId = createUniqueId();
  const title = () => t(TITLE_KEYS[props.slackAsk.kind], { place: props.slackAsk.place });
  const showAuthors = () => props.slackAsk.kind === "auto-reply";
  return (
    <article class="slack-ask-card conversation-interaction-card" aria-label={title()}>
      <header class="slack-ask-card-header">
        <SlackMark class="slack-ask-card-mark" />
        <span class="slack-ask-card-title">{title()}</span>
        <time class="slack-ask-card-time" datetime={props.createdAt}>
          {props.time}
        </time>
      </header>
      <Show when={props.slackAsk.trigger.length > 0}>
        <ul class="slack-ask-card-messages" aria-label={t("chat.slackAsk.messages")}>
          <For each={props.slackAsk.trigger}>
            {(line) => (
              <li class="slack-ask-card-message">
                <Show when={showAuthors() && line.author}>
                  <span class="slack-ask-card-author">{line.author}: </span>
                </Show>
                {line.text}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="slack-ask-card-actions">
        <Show when={props.onOpenConversation}>
          {(open) => (
            <Button variant="ghost" size="xs" type="button" class="slack-ask-card-action" onClick={() => open()()}>
              <ExternalLink aria-hidden="true" />
              {t("chat.slackAsk.openConversation")}
            </Button>
          )}
        </Show>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          class="slack-ask-card-action slack-ask-card-toggle"
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={contextId}
          onClick={() => setExpanded(!expanded())}
        >
          <ChevronDown aria-hidden="true" />
          {t(expanded() ? "chat.slackAsk.hideContext" : "chat.slackAsk.showContext")}
        </Button>
      </div>
      <Show when={expanded()}>
        <p id={contextId} class="slack-ask-card-context">
          {props.text}
        </p>
      </Show>
    </article>
  );
}
