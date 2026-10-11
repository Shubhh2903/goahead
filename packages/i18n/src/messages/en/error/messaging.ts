import { defineMessages } from "../../../message";

export const messages = defineMessages("error.messaging", {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "This Slack workspace is not connected.",
  "error.messaging.unsupported": "This computer cannot connect to Slack.",
  "error.messaging.relayUnavailable":
    "GoAhead cannot receive Slack events on this computer. Sign in, give this computer a name, and try again.",
  // An agent's request to send a message that cannot become a draft.
  "error.messaging.sendUnavailable": "Sending Slack messages is not available on this computer.",
  "error.messaging.sendNeedsSlack": "A message can only be drafted from a Slack conversation.",
  "error.messaging.sendNeedsUser":
    "Connect the Slack workspace as you in GoAhead before agents can send messages. Only you can approve a send.",
  "error.messaging.sendTargetInvalid": "The recipient is not a Slack user id or channel id.",
  "error.messaging.sendToSelf":
    "The GoAhead user reads this conversation. Answer here instead of sending them a message.",
  "error.messaging.sendDirectNeedsUser": "Use the person's Slack user ID, such as <@U0123>, to send a direct message.",
  "error.messaging.sendTextEmpty": "The message has no text.",
  // A send that the person's guards stop. The agent reads these, and so does the person.
  "error.messaging.sendPaused": "Slack sends are paused in GoAhead. Nothing was sent.",
  "error.messaging.sendQuietHours": "Quiet hours: GoAhead sends no Slack messages until {time}. The draft waits.",
  // A Slack conversation that the sidebar asked for is gone or is not a Slack conversation.
  "error.messaging.threadUnavailable": "This Slack conversation is not available.",
  // An agent's read of the GoAhead user's local Slack inbox that is refused.
  "error.messaging.inboxNeedsSlack":
    "Slack messages can only be read in your direct message with GoAhead, or when you ask the Slack Orchestrator in GoAhead on this computer.",
  "error.messaging.inboxNeedsUser":
    "Connect the Slack workspace as you in GoAhead before agents can read your Slack messages.",
  "error.messaging.inboxOwnerOnly": "Only the GoAhead user can ask to read their Slack messages.",
  "error.messaging.inboxUnknownConversation":
    "That Slack conversation is not in the GoAhead inbox. Use slack_list_unread to see the conversations it keeps.",
  // An `@chief` instruction from the inbox when the workspace has no Slack Orchestrator.
  "error.messaging.inboxNeedsOrchestrator": "Add the Slack Orchestrator first.",
  // The Slack client: a read or an action of the person that is refused before Slack is called.
  "error.messaging.clientNeedsUser": "Connect the Slack workspace as you in GoAhead to use its messages here.",
  "error.messaging.clientNeedsUserRead": "Connect the Slack workspace as you in GoAhead to read your conversations.",
  "error.messaging.clientNotYours": "You can only edit or delete your own messages.",
  "error.messaging.clientTextTooLong": "The message is longer than {limit} characters. Nothing was sent.",
  "error.messaging.clientFileTooLarge": "The file is larger than {limit} MB. Nothing was sent.",
});
