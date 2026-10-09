import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { Button, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createStore, Show } from "solid-js";

/** Text that starts with `@chief`, then a space or nothing, goes to the Slack Orchestrator. */
const CHIEF_PREFIX = /^@chief(?:\s|$)/i;

/**
 * The box that sends a reply as the person in the open inbox conversation. It needs no approval. Text
 * that starts with `@chief` is not sent: it goes to the Slack Orchestrator as an instruction. A
 * failure gives the text back, so the person can try again.
 */
export function MessagingInboxReply(props: {
  onSend: (text: string) => Promise<void>;
  onAsk: (text: string) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [reply, setReply] = createStore<{ text: string; sending: boolean; error: string | null }>({
    text: "",
    sending: false,
    error: null,
  });
  const asksChief = () => CHIEF_PREFIX.test(reply.text.trim());
  const ready = () => {
    const text = reply.text.trim();
    if (reply.sending || !text) return false;
    return !asksChief() || text.replace(CHIEF_PREFIX, "").trim().length > 0;
  };

  const send = () => {
    if (!ready()) return;
    const text = reply.text.trim();
    const ask = asksChief();
    // A reply shows in the conversation at once, so the box clears at once. An `@chief` instruction
    // keeps its text until the orchestrator has it.
    setReply((draft) => {
      draft.sending = true;
      draft.error = null;
      if (!ask) draft.text = "";
    });
    (ask ? props.onAsk(text) : props.onSend(text)).then(
      () =>
        setReply((draft) => {
          if (ask) draft.text = "";
          draft.sending = false;
        }),
      (error: unknown) =>
        setReply((draft) => {
          draft.sending = false;
          // Text typed while the reply was on its way stays after the failed reply.
          if (!ask) draft.text = draft.text ? `${text}\n${draft.text}` : text;
          draft.error = ask
            ? errorMessage(error, t("messaging.inbox.reply.askFailed"))
            : t("messaging.inbox.reply.failed");
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
      <Show when={reply.error}>
        {(error) => (
          <p role="alert" class="messaging-inbox-reply-error">
            {error()}
          </p>
        )}
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
          {asksChief() ? t("messaging.inbox.reply.askChief") : t("messaging.inbox.reply.send")}
        </Button>
      </div>
      <p class="messaging-inbox-reply-hint">{t("messaging.inbox.reply.chiefHint")}</p>
    </form>
  );
}
