import { defineMessages } from "../../../message";

export const messages = defineMessages("status.messaging", {
  "status.messaging.working": "Working on it…",
  "status.messaging.queued": "Waiting for an earlier request to finish. The answer comes here.",
  "status.messaging.busy": "Too many requests are waiting. Try again later.",
  "status.messaging.failed": "GoAhead could not finish this request. The GoAhead host has the details.",
  "status.messaging.noAnswer": "GoAhead finished without a written answer.",
  "status.messaging.noAgent": "No agent can answer here yet. Add the Slack Orchestrator in GoAhead.",
  "status.messaging.delegated": "A teammate is working on it. The answer comes here.",
  "status.messaging.stopped": "Stopped.",
  "status.messaging.stop": "Stop",
  "status.messaging.approvalTitle": "GoAhead asks for approval to continue.",
  "status.messaging.approvalTitleTeammate": "Teammate {agent} asks for approval to continue.",
  "status.messaging.approvalCommand": "Run a command",
  "status.messaging.approvalFileChange": "Change files",
  "status.messaging.approvalPermissions": "Get more permissions",
  "status.messaging.approve": "Approve",
  "status.messaging.deny": "Deny",
  "status.messaging.approvedBy": "Approved by {user}.",
  "status.messaging.deniedBy": "Denied by {user}.",
  "status.messaging.answeredOnHost": "Answered on the GoAhead host.",
  "status.messaging.requestInactive": "This request is no longer active.",
  "status.messaging.onlyRequester": "Only {user} can do this. The GoAhead host can also answer.",
  "status.messaging.hostOnly": "Only the GoAhead host can answer this request.",
  "status.messaging.filesSkipped": "Some files were not sent: {names}.",
  "status.messaging.sendDraftTitle": "GoAhead asks for approval to send a message.",
  "status.messaging.sendDraftTo": "To: {to}",
  "status.messaging.sendAsUser": "As: {user}",
  "status.messaging.sendAsBot": "Sent by the GoAhead app, not as you.",
  "status.messaging.sentFor": "{name} asked me to send this:",
  "status.messaging.sent": "Sent. Approved by {user}.",
  "status.messaging.sendFailed": "Not sent: {reason}",
  "status.messaging.autoReplyLoopPaused":
    "Auto-reply paused in {conversation}: it looks like a reply loop. Check it, then tell me to continue.",
  "status.messaging.handoffTask": "{from} → {agent}: {task}",
  "status.messaging.handoffQueued": "{agent}: waiting to start",
  "status.messaging.handoffThinking": "{agent}: thinking…",
  "status.messaging.handoffRunning": "{agent}: running {name}…",
  "status.messaging.handoffEditing": "{agent}: editing {name}…",
  "status.messaging.handoffSearching": "{agent}: searching the web…",
  "status.messaging.handoffUsing": "{agent}: using {name}…",
  "status.messaging.handoffDone": "{agent}: done",
  "status.messaging.handoffFailed": "{agent}: stopped before it finished",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Answers in Slack and asks the team",
  "status.messaging.discordNoAgent": "No agent can answer here yet. Add the Discord Orchestrator in GoAhead.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Answers in Discord and asks the team",
  "status.messaging.integrationsSection": "Integrations",
  "status.messaging.signInReceived": "GoAhead received the Slack install. You can close this tab.",
  "status.messaging.signInUnknown": "GoAhead did not start this Slack install. Start it again in GoAhead.",
  "status.messaging.googleImportantMail": "Important mail from {from}: {subject}",
  "status.messaging.googleMeetingRequest": "Meeting request from {from}: {subject}",
  "status.messaging.googleSendDetail":
    "To: {to}\nCc: {cc}\nBcc: {bcc}\nAttachments: {attachments}\nSubject: {subject}\n\n{body}",
  "status.messaging.googleDraftUnreadable": "GoAhead could not read the draft text. It is in Gmail Drafts.",
  "status.messaging.googleMeetingDetail": "{title}\n{start} to {end} ({timeZone})\nGuests: {guests}\n\n{description}",
  "status.messaging.googleNone": "none",
  "status.messaging.googleUnknown": "unknown",
  "status.messaging.googleSent": 'Gmail sent the mail "{subject}".',
  "status.messaging.googleSendDeclined": 'You declined to send the mail "{subject}". The draft stays in Gmail Drafts.',
  "status.messaging.googleSendError":
    'Gmail did not send the mail "{subject}": {detail}. The draft stays in Gmail Drafts. To try again, approve the new card.',
  "status.messaging.googleSendFailedNoRetry":
    'Gmail did not send the mail "{subject}": {detail}. The draft stays in Gmail Drafts.',
  "status.messaging.googleSendUncertain":
    'Gmail may have sent the mail "{subject}" ({detail}). Check Sent in Gmail before you send it again.',
  "status.messaging.googleSendChanged":
    'The draft "{subject}" changed after GoAhead showed it. Nothing was sent. Check the new card.',
  "status.messaging.googleSendChangedNoRetry":
    'The draft "{subject}" changed after GoAhead showed it. Nothing was sent. It stays in Gmail Drafts.',
  "status.messaging.googleSendUnreadable": 'GoAhead could not read the draft "{subject}" again. Nothing was sent.',
  "status.messaging.googleBooked": 'The meeting "{title}" is booked and the invitations are sent. Google Meet: {link}',
  "status.messaging.googleBookDeclined": 'You declined the meeting "{title}". Nothing was created.',
  "status.messaging.googleBookFailedNoRetry":
    'Google Calendar did not create the meeting "{title}": {detail}. Nothing was created.',
  "status.messaging.googleBookError":
    'Google Calendar did not create the meeting "{title}": {detail}. Nothing was created. To try again, approve the new card.',
  "status.messaging.telegramNoAgent":
    "No agent can answer here yet. In GoAhead, open Marketplace > Apps > Telegram and click Add agent.",
  "status.messaging.telegramLinked":
    "GoAhead is connected to this chat. Mention {bot} or reply to a message of GoAhead to ask the agents.",
  "status.messaging.telegramNotLinked":
    "GoAhead is not connected to this chat. To connect it, open the GoAhead app, go to Marketplace → Apps → Telegram, and select Add to a group or Open a direct chat.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Answers in Telegram and asks the team",
  "status.messaging.whatsappNoAgent": "No agent can answer here yet. Add the WhatsApp Orchestrator in GoAhead.",
  "status.messaging.whatsappApprovalMenu": "Reply 1 to approve or 2 to deny.",
  "status.messaging.whatsappStopMenu": "Reply stop to stop.",
  "status.messaging.whatsappPairingCode":
    "This number answers only people that its owner allowed. Give the owner this code: {code}",
  "status.messaging.whatsappPairingApproved": "You can now send requests to this number.",
  "status.messaging.whatsappOwnChat": "Message yourself",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *GoAhead is connected*\n\nWrite here to ask your agents. The WhatsApp Orchestrator answers, or gives the work to the right agent.\n\nSend *stop* to stop a request.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *GoAhead is connected*\n\nThe people you allow in GoAhead can now write to this number. A new person gets a code: approve it in GoAhead under Requests.\n\nSend *stop* to stop a request.",
  "status.messaging.whatsappOtherOpenBot":
    "Another GoAhead is linked to this WhatsApp number, so you can get two answers. To fix this, open Linked devices in WhatsApp on your phone and log out the GoAhead that you do not use.",
  "status.messaging.whatsappPaused":
    "GoAhead stopped answering here for 10 minutes: too many messages came in a short time. If another GoAhead is linked to this number, open Linked devices in WhatsApp on your phone and log out the GoAhead that you do not use.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Answers in WhatsApp and asks the team",
});
