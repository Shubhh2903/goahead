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
  // The read-only view of the person's local Slack inbox.
  "messaging.inbox.title": "Slack inbox",
  "messaging.inbox.conversations": "Inbox conversations",
  "messaging.inbox.messages": "Messages",
  "messaging.inbox.empty":
    "No Slack messages yet. GoAhead keeps your direct messages, group messages, mentions and the channels you pick.",
  "messaging.inbox.choose": "Choose a conversation to read it.",
  "messaging.inbox.file.open": "Open {name} in Slack",
  "messaging.inbox.loadFailed": "The Slack inbox did not load.",
  "messaging.inbox.unread": { one: "{count} unread", other: "{count} unread" },
  // The box that sends a reply as the person in the open inbox conversation.
  "messaging.inbox.reply.placeholder": "Reply as you",
  "messaging.inbox.reply.send": "Send",
  "messaging.inbox.reply.failed": "Slack did not accept the reply.",
  // Text that starts with `@chief` goes to the Slack Orchestrator, not to Slack.
  "messaging.inbox.reply.askChief": "Ask Chief",
  "messaging.inbox.reply.chiefHint": "Start with @chief to ask the Slack Orchestrator instead of sending.",
  "messaging.inbox.reply.askFailed": "The Slack Orchestrator did not get the request.",
  // The Slack client: every conversation of the connected person, in three panes.
  "messaging.client.section.unreads": "Unreads",
  "messaging.client.section.channels": "Channels",
  "messaging.client.section.direct": "Direct messages",
  "messaging.client.search.placeholder": "Find a conversation",
  "messaging.client.loadOlder": "Load older messages",
  "messaging.client.offline": "Offline: showing saved messages",
  "messaging.client.loadError": "Could not load messages from Slack. Try again.",
  "messaging.client.message.edit": "Edit",
  "messaging.client.message.delete": "Delete",
  "messaging.client.message.edited": "edited",
  "messaging.client.message.deleted": "This message was deleted.",
  "messaging.client.deleteConfirm.title": "Delete this message?",
  "messaging.client.deleteConfirm.confirm": "Delete",
  "messaging.client.deleteConfirm.cancel": "Cancel",
  "messaging.client.replies": { one: "{count} reply", other: "{count} replies" },
  "messaging.client.replyInThread": "Reply in thread",
  "messaging.client.alsoSendToChannel": "Also send to channel",
  "messaging.client.attach": "Attach a file",
  "messaging.client.addReaction": "Add reaction",
  "messaging.client.uploading": "Uploading {name}…",
  "messaging.client.thread.title": "Thread",
  "messaging.client.thread.close": "Close",
});
