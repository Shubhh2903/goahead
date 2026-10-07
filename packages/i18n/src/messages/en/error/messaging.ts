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
  "error.messaging.sendTextEmpty": "The message has no text.",
});
