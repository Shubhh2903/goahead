import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { Button, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createStore, Show } from "solid-js";

/**
 * The box that sends a reply as the person in the open inbox conversation. It needs no approval. A
 * failed send keeps the text, so the person can send it again.
 */
export function MessagingInboxReply(props: { onSend: (text: string) => Promise<void> }) {
  const { t } = useText();
  const [reply, setReply] = createStore({ text: "", sending: false, failed: false });
  const ready = () => !reply.sending && reply.text.trim().length > 0;

  const send = () => {
    if (!ready()) return;
    const text = reply.text.trim();
    setReply((draft) => {
      draft.sending = true;
      draft.failed = false;
    });
    props.onSend(text).then(
      () =>
        setReply((draft) => {
          draft.text = "";
          draft.sending = false;
        }),
      () =>
        setReply((draft) => {
          draft.sending = false;
          draft.failed = true;
        }),
    );
  };

  return (
    <form
      class="messaging-inbox-reply"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Show when={reply.failed}>
        <p role="alert" class="messaging-inbox-reply-error">
          {t("messaging.inbox.reply.failed")}
        </p>
      </Show>
      <div class="messaging-inbox-reply-row">
        <Textarea
          rows={2}
          value={reply.text}
          maxlength={MESSAGING_LIMITS.inboxReply}
          placeholder={t("messaging.inbox.reply.placeholder")}
          aria-label={t("messaging.inbox.reply.placeholder")}
          onValueChange={(text: string) =>
            setReply((draft) => {
              draft.text = text;
            })
          }
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <Button type="submit" size="sm" disabled={!ready()}>
          {t("messaging.inbox.reply.send")}
        </Button>
      </div>
    </form>
  );
}
