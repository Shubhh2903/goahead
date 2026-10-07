import { defineMessages } from "../../message";

export const messages = defineMessages("messaging", {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack no longer accepts GoAhead in this workspace. It may have been uninstalled. Connect the workspace again.",
  "messaging.help.secret_storage_unavailable":
    "GoAhead cannot read the saved tokens on this computer. Disconnect the workspace, then connect it again.",
  "messaging.help.relay_unavailable":
    "GoAhead cannot receive Slack events on this computer. Sign in, give this computer a name in Server settings, and keep GoAhead open.",
  // The read-only view of one Slack conversation that an agent answers.
  "messaging.thread.label": "Slack conversation: {title}",
  "messaging.thread.readOnly": "Read-only. The agent answers this conversation in Slack.",
  "messaging.thread.slackPerson": "Slack user",
  "messaging.thread.empty": "No messages yet.",
  "messaging.thread.loadFailed": "The Slack conversation did not load.",
  // A message an agent drafted, which waits for the person on the desktop.
  "messaging.draft.label": "Message draft to {recipient}",
  "messaging.draft.title": "Message waits for your approval",
  "messaging.draft.to": "To {recipient}",
  "messaging.draft.asUser": "sends as you",
  "messaging.draft.asBot": "sends as GoAhead",
  "messaging.draft.requestedBy": "{name} asked for it",
  "messaging.draft.textLabel": "Message text",
  "messaging.draft.approve": "Approve and send",
  "messaging.draft.deny": "Deny",
  "messaging.draft.sending": "Sending…",
  "messaging.draft.failed": "The draft could not be answered.",
});
