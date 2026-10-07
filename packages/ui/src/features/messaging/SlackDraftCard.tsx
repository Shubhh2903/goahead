/**
 * A message an agent drafted to send in Slack, which waits for the person. They can change the
 * text, then approve or deny it. The Slack buttons answer the same draft; the first answer counts.
 */

import type { MessagingDraft } from "@openbot/contracts/ipc";
import { Button, Card, Text, Textarea } from "@openbot/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";

export interface SlackDraftCardProps {
  draft: MessagingDraft;
  /** True while this draft's answer is on its way. */
  busy: boolean;
  /** The text is the person's edited text, or undefined when they did not change it. */
  onApprove: (text: string | undefined) => void;
  onDeny: () => void;
}

export function SlackDraftCard(props: SlackDraftCardProps) {
  const { t } = useText();
  const [text, setText] = createSignal(props.draft.text);
  createEffect(
    () => props.draft.draftId,
    () => {
      setText(props.draft.text);
    },
  );
  const changed = () => text() !== props.draft.text;
  const empty = () => text().trim().length === 0;
  const fieldId = () => `slack-draft-${props.draft.draftId}`;
  return (
    <Card
      class="slack-draft-card"
      role="group"
      aria-label={t("messaging.draft.label", { recipient: props.draft.recipient })}
    >
      <div class="slack-draft-card-head">
        <h2 class="slack-draft-card-title">{t("messaging.draft.title")}</h2>
        <Text variant="caption" tone="muted">
          {t("messaging.draft.to", { recipient: props.draft.recipient })} ·{" "}
          {props.draft.sender === "user" ? t("messaging.draft.asUser") : t("messaging.draft.asBot")}
        </Text>
        <Show when={props.draft.requestedBy}>
          {(name) => (
            <Text variant="caption" tone="muted">
              {t("messaging.draft.requestedBy", { name: name() })}
            </Text>
          )}
        </Show>
      </div>
      <label class="sr-only" for={fieldId()}>
        {t("messaging.draft.textLabel")}
      </label>
      <Textarea
        id={fieldId()}
        class="slack-draft-card-text"
        rows={4}
        value={text()}
        disabled={props.busy}
        onValueChange={setText}
      />
      <div class="slack-draft-card-actions">
        <Button type="button" variant="ghost" disabled={props.busy} onClick={() => props.onDeny()}>
          {t("messaging.draft.deny")}
        </Button>
        <Button
          type="button"
          loading={props.busy}
          loadingLabel={t("messaging.draft.sending")}
          disabled={empty()}
          onClick={() => props.onApprove(changed() ? text() : undefined)}
        >
          {t("messaging.draft.approve")}
        </Button>
      </div>
    </Card>
  );
}
