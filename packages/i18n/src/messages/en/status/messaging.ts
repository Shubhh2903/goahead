import { defineMessages } from "../../../message";

export const messages = defineMessages("status.messaging", {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "Working on it…",
  "status.messaging.queued": "Waiting: GoAhead is working on another request. The answer comes here.",
  "status.messaging.busy": "Too many requests are waiting. Try again later.",
  "status.messaging.failed": "GoAhead could not finish this request. The GoAhead host has the details.",
  "status.messaging.noAnswer": "GoAhead finished without a written answer.",
  "status.messaging.noAgent": "No agent can answer here yet. Add the Slack Orchestrator in GoAhead.",
  "status.messaging.delegated": "A teammate is working on it. The answer comes here.",
  "status.messaging.stopped": "Stopped.",
  "status.messaging.stop": "Stop",
  "status.messaging.approvalTitle": "GoAhead asks for approval to continue.",
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
  // A message an agent drafted for a person or channel. {to} and {user} are Slack mentions.
  "status.messaging.sendDraftTitle": "GoAhead asks for approval to send a message.",
  "status.messaging.sendDraftTo": "To: {to}",
  "status.messaging.sendAsUser": "As: {user}",
  "status.messaging.sendAsBot": "Sent by the GoAhead app, not as you.",
  // The first line of a message that the GoAhead app sends for someone other than the GoAhead user.
  "status.messaging.sentFor": "{name} asked me to send this:",
  "status.messaging.sent": "Sent. Approved by {user}.",
  "status.messaging.sendFailed": "Not sent: {reason}",
  // The Slack Orchestrator tells the GoAhead user this in GoAhead. {conversation} is a person or channel name.
  "status.messaging.autoReplyLoopPaused":
    "Auto-reply paused in {conversation}: it looks like a reply loop. Check it, then tell me to continue.",
  // One status message in a Slack thread while a teammate works on a request from it. Each hand-off
  // has two lines: who asked whom to do what, and how far the teammate is. {from} and {agent} are
  // agent names; {name} is a program, a file name or a tool, never its arguments.
  "status.messaging.handoffTask": "{from} → {agent}: {task}",
  "status.messaging.handoffQueued": "{agent}: waiting to start",
  "status.messaging.handoffThinking": "{agent}: thinking…",
  "status.messaging.handoffRunning": "{agent}: running {name}…",
  "status.messaging.handoffEditing": "{agent}: editing {name}…",
  "status.messaging.handoffSearching": "{agent}: searching the web…",
  "status.messaging.handoffUsing": "{agent}: using {name}…",
  "status.messaging.handoffDone": "{agent}: done",
  "status.messaging.handoffFailed": "{agent}: stopped before it finished",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Answers in Slack and asks the team",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "Integrations",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "GoAhead received the Slack install. You can close this tab.",
  "status.messaging.signInUnknown": "GoAhead did not start this Slack install. Start it again in GoAhead.",
  // A note from GoAhead in the chat of the agent that handles mail. It starts no turn.
  "status.messaging.googleImportantMail": "Important mail from {from}: {subject}",
  "status.messaging.googleMeetingRequest": "Meeting request from {from}: {subject}",
  // The approval card of a Google action. The person approves the real draft or event.
  "status.messaging.googleSendDetail":
    "To: {to}\nCc: {cc}\nBcc: {bcc}\nAttachments: {attachments}\nSubject: {subject}\n\n{body}",
  "status.messaging.googleDraftUnreadable": "GoAhead could not read the draft text. It is in Gmail Drafts.",
  "status.messaging.googleMeetingDetail": "{title}\n{start} to {end} ({timeZone})\nGuests: {guests}\n\n{description}",
  "status.messaging.googleNone": "none",
  "status.messaging.googleUnknown": "unknown",
  // A note from GoAhead in the chat after an approval. It starts no turn.
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
});
