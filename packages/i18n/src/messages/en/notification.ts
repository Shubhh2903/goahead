import { defineMessages } from "../../message";

export const messages = defineMessages("notification", {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.finished": "Finished working.",
  "notification.failed": "Stopped with an error.",
  "notification.usageLimit.title": "{provider} account reached its limit",
  "notification.usageLimit.body": {
    one: "{count} agent waits. GoAhead will try again later.",
    other: "{count} agents wait. GoAhead will try again later.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent waits. Resets {reset}.",
    other: "{count} agents wait. Resets {reset}.",
  },
  "notification.test": "Notifications are working.",
  "notification.welcome": "GoAhead will tell you here when an agent needs you.",
  // The toast region in each window.
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Close notification",
  // A macOS notification for one mail notice. {from} is the sender.
  "notification.google.importantTitle": "Important mail from {from}",
  "notification.google.meetingTitle": "Meeting request from {from}",
  "notification.google.expiredTitle": "Google sign-in expired",
  "notification.google.expiredBody": "Open GoAhead to sign in to Google again.",
});
