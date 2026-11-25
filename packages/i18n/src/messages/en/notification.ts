import { defineMessages } from "../../message";

export const messages = defineMessages("notification", {
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.needsBrowserStep": "Needs you to finish a step in the browser.",
  "notification.waitsForSignIn": "Waits for {provider} sign-in.",
  "notification.needsApprovalFor": "Needs your approval: {action}",
  "notification.finished": "Finished working.",
  "notification.workflowApproval": "A step waits for your approval.",
  "notification.workflowOutput": "A workflow has a new result.",
  "notification.failed": "Stopped with an error.",
  "notification.subagentFailed": "A subagent stopped with an error.",
  "notification.subagentFailedFor": "A subagent stopped with an error: {task}",
  "notification.channelTitle": "{agent} in {channel}",
  "notification.channelMessage": "Sent a message.",
  "notification.usageLimit.title": "{provider} account reached its limit",
  "notification.usageLimit.body": {
    one: "{count} agent waits. GoAhead will try again later.",
    other: "{count} agents wait. GoAhead will try again later.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent waits. Resets {reset}.",
    other: "{count} agents wait. Resets {reset}.",
  },
  "notification.machineAlert.disk": "{server}: disk {percent} full",
  "notification.machineAlert.memory": "{server}: memory {percent} used",
  "notification.machineAlert.cpu": "{server}: CPU {percent} busy",
  "notification.machineAlert.body": "It passed the alert level of {level}. See Server settings > Storage.",
  "notification.test": "Notifications are working.",
  "notification.welcome": "GoAhead will tell you here when an agent needs you.",
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Close notification",
  // A macOS notification for one mail notice. {from} is the sender.
  "notification.google.importantTitle": "Important mail from {from}",
  "notification.google.meetingTitle": "Meeting request from {from}",
  "notification.google.expiredTitle": "Google sign-in expired",
  "notification.google.expiredBody": "Open GoAhead to sign in to Google again.",
  "notification.tokenBudget.title": "{name} used {percent}% of its weekly token budget",
  "notification.tokenBudget.body":
    "{used} of {budget} tokens this week. Work continues. Change the budget in the agent settings.",
});
