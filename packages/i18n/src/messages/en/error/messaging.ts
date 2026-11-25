import { defineMessages } from "../../../message";

export const messages = defineMessages("error.messaging", {
  "error.messaging.notConnected": "This Slack workspace is not connected.",
  "error.messaging.unsupported": "This computer cannot connect to Slack.",
  "error.messaging.relayUnavailable":
    "GoAhead cannot receive Slack events on this computer. Sign in, give this computer a name, and try again.",
  "error.messaging.sendUnavailable": "Sending Slack messages is not available on this computer.",
  "error.messaging.sendNeedsSlack": "A message can only be drafted from a Slack conversation.",
  "error.messaging.sendNeedsUser":
    "Connect the Slack workspace as you in GoAhead before agents can send messages. Only you can approve a send.",
  "error.messaging.sendTargetInvalid": "The recipient is not a Slack user id or channel id.",
  "error.messaging.sendToSelf":
    "The GoAhead user reads this conversation. Answer here instead of sending them a message.",
  "error.messaging.sendDirectNeedsUser": "Use the person's Slack user ID, such as <@U0123>, to send a direct message.",
  "error.messaging.sendTextEmpty": "The message has no text.",
  "error.messaging.sendPaused": "Slack sends are paused in GoAhead. Nothing was sent.",
  "error.messaging.sendQuietHours": "Quiet hours: GoAhead sends no Slack messages until {time}. The draft waits.",
  "error.messaging.sendQuietHoursNoDraft":
    "Quiet hours: GoAhead sends no Slack messages until {time}. Nothing was sent. Ask again after {time}.",
  "error.messaging.sendNameUnknown":
    'No one in the Slack workspace is named "{name}". Nothing was sent. Ask the GoAhead user for the full name.',
  "error.messaging.sendNameAmbiguous":
    'More than one match in Slack for "{name}": {people}. Nothing was sent. Ask the GoAhead user which one they mean.',
  "error.messaging.sendChannelUnknown": 'No Slack channel is named "#{name}". Nothing was sent.',
  "error.messaging.sendUseOrchestrator":
    "Only the {name} sends Slack messages from GoAhead. Nothing was sent. Give it the message and the recipient with send_message (agent id {agentId}).",
  "error.messaging.sendWorkspaceUnclear":
    "The recipient is not in exactly one of your Slack workspaces. Nothing was sent. Use a user or channel ID from one workspace.",
  "error.messaging.threadUnavailable": "This Slack conversation is not available.",
  "error.messaging.inboxNeedsSlack":
    "Slack messages can only be read in your direct message with GoAhead, or when you ask the Slack Orchestrator in GoAhead on this computer.",
  "error.messaging.inboxNeedsUser":
    "Connect the Slack workspace as you in GoAhead before agents can read your Slack messages.",
  "error.messaging.inboxOwnerOnly": "Only the GoAhead user can ask to read their Slack messages.",
  "error.messaging.inboxUnknownConversation":
    "That Slack conversation is not in the GoAhead inbox. Use slack_list_unread to see the conversations it keeps.",
  "error.messaging.inboxNeedsOrchestrator": "Add the Slack Orchestrator first.",
  "error.messaging.clientNeedsUser": "Connect the Slack workspace as you in GoAhead to use its messages here.",
  "error.messaging.clientNeedsUserRead": "Connect the Slack workspace as you in GoAhead to read your conversations.",
  "error.messaging.clientNotYours": "You can only edit or delete your own messages.",
  "error.messaging.clientTextTooLong": "The message is longer than {limit} characters. Nothing was sent.",
  "error.messaging.clientFileTooLarge": "The file is larger than {limit} MB. Nothing was sent.",
  "error.messaging.discordNotConnected": "This Discord server is not connected.",
  "error.messaging.discordUnsupported": "This computer cannot connect to Discord.",
  "error.messaging.discordRelayUnavailable":
    "GoAhead cannot receive Discord events on this computer. Sign in, give this computer a name, and try again.",
  "error.messaging.discordRolesUnsupported": "GoAhead cannot list Discord roles yet. Try again later.",
  "error.messaging.telegramNotConnected": "This Telegram chat is not connected.",
  "error.messaging.telegramUnsupported": "This computer cannot connect to Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "GoAhead cannot reach Telegram on this computer. Sign in, give this computer a name, and try again.",
  "error.messaging.telegramRelayUnreachable":
    "GoAhead cannot connect to its service from this computer. Check the internet connection, VPN, proxy, or firewall, and try again.",
  "error.messaging.telegramServiceUnavailable": "GoAhead cannot connect Telegram now. Try again later.",
  "error.messaging.whatsappNotConnected": "This WhatsApp number is not connected.",
  "error.messaging.whatsappUnsupported": "This computer cannot connect to WhatsApp.",
  "error.messaging.whatsappTooManySenders": "A WhatsApp number can allow up to 200 contacts and groups.",
  "error.messaging.whatsappNumberNotFound":
    "This number has no WhatsApp account. Type it with its country code, such as +44 7700 900123.",
  "error.messaging.whatsappSenderNotFound": "This contact or group is not on the list now.",
  "error.messaging.whatsappRequestEnded": "This request ended. Ask the person to write again for a new code.",
  "error.messaging.memoryLimit": "A connected workspace can have up to {limit} memories. Delete one first.",
});
