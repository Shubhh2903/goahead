import { defineMessages } from "../../../message";

export const messages = defineMessages("error.connector", {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "This build of GoAhead has no GitHub App.",
  "error.connector.githubDenied": "The GitHub sign-in was refused.",
  "error.connector.githubCodeExpired": "The GitHub code expired. Connect GitHub again.",
  "error.connector.githubDeviceFlowDisabled": "The GitHub App does not allow device sign-in.",
  "error.connector.githubClientUnknown": "GitHub does not know the Client ID of this GitHub App.",
  "error.connector.githubUnexpected": "GitHub sent an unexpected answer: {detail}",
  "error.connector.githubUnreachable": "GoAhead cannot reach GitHub: {detail}",
  "error.connector.githubExpired": "The GitHub connection expired. Connect GitHub again.",
  "error.connector.githubFileUnreadable": "The GitHub connection file is unreadable.",
  "error.connector.githubFileTooLarge": "The GitHub connection file is too large.",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "GoAhead cannot find the 1Password CLI. Install it and turn on its integration in the 1Password app, or use a service account token.",
  "error.connector.onePasswordCliInstallFailed":
    "GoAhead could not install the 1Password CLI. Check the connection to the internet, then try again.",
  "error.connector.onePasswordCliSignedOut":
    "The 1Password CLI is not signed in. Turn on its integration in the 1Password app, then connect again.",
  "error.connector.onePasswordCliFailed": "The 1Password CLI failed: {detail}",
  "error.connector.onePasswordUnexpected": "1Password sent an unexpected answer: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password did not accept the service account token.",
  "error.connector.onePasswordNoVault":
    "The service account cannot read a vault. Give it access to a vault, then try again.",
  "error.connector.onePasswordFileUnreadable": "The 1Password connection file is unreadable.",
  "error.connector.onePasswordFileTooLarge": "The 1Password connection file is too large.",
  // The built-in Gmail and Google Calendar connection: the sign-in, the stored file and the API calls.
  "error.connector.googleUnavailable": "This build of GoAhead has no Google sign-in.",
  "error.connector.googleSignInTimedOut": "The Google sign-in took too long. Connect Google again.",
  "error.connector.googleSignInCancelled": "The Google sign-in was cancelled.",
  "error.connector.googleRefused": "Google refused the sign-in: {detail}",
  "error.connector.googleUnexpected": "Google sent an unexpected answer: {detail}",
  "error.connector.googleUnreachable": "GoAhead cannot reach Google.",
  "error.connector.googleSignInExpired": "The Google sign-in expired. Sign in to Google again.",
  "error.connector.googleNotConnected": "Google is not connected.",
  "error.connector.googleNoRefreshToken": "Google did not give a sign-in that can stay active. Connect Google again.",
  "error.connector.googleScopesMissing": "Allow GoAhead to use Gmail and Google Calendar, then connect again.",
  "error.connector.googleRevokeFailed":
    "GoAhead removed the Google sign-in from this computer, but Google did not confirm the revoke. Remove GoAhead at myaccount.google.com/permissions.",
  "error.connector.googleRequestFailed": "Google refused the request (status {status}).",
  "error.connector.googleFileUnreadable": "The Google connection file is unreadable.",
  "error.connector.googleFileTooLarge": "The Google connection file is too large.",
  "error.connector.googleMailAgentUnknown": "This agent is not on this computer.",
  // The Gmail and Google Calendar tools of the mail agents.
  "error.connector.googleMailAgentOnly":
    "Only the agent that handles mail, or the Slack Orchestrator, can use Gmail and Google Calendar.",
  "error.connector.googleOwnerOnly":
    "Gmail and Google Calendar can only be used when you ask in GoAhead on this computer, or in your own direct message with GoAhead in Slack.",
  "error.connector.gmailNoTrash": "GoAhead does not delete or trash mail.",
  "error.connector.gmailNoChange": "Name a label change, archive, read or star.",
  "error.connector.gmailNoMessage": "Name a message id or a thread id.",
  "error.connector.gmailBadAddress": "{address} is not an email address.",
  "error.connector.gmailNoRecipient": "The mail has no recipient.",
  "error.connector.gmailBadHeader": "The subject or a reply header has a line break.",
  "error.connector.calendarBadRange": "The time range is not valid.",
  "error.connector.calendarRangeTooLong": "The time range can be at most 14 days.",
  "error.connector.googleApprovalLocalOnly": "Only the person at the GoAhead computer can answer this approval.",
  "error.connector.gmailSendNeedsBody": "Give a draft id, or the text of a new mail.",
  "error.connector.gmailSendFailed": "Gmail did not send the mail: {detail}",
  "error.connector.calendarBookFailed": "Google Calendar did not create the meeting: {detail}",
  "error.connector.googleApprovalTooLong":
    "This is too long to approve in GoAhead. Send the mail from Gmail, or create the event in Google Calendar.",
  "error.connector.googleApprovalIncomplete":
    "GoAhead cannot show all of this request, so you cannot allow it here. Deny it, and use Gmail or Google Calendar.",
  "error.connector.gmailDraftAwaitsApproval":
    "This draft waits for the GoAhead user's approval, so it cannot change now. Make a new draft if a change is necessary.",
  "error.connector.gmailDraftChanged":
    "The draft changed after GoAhead showed it. Nothing was sent. Check the new card.",
  "error.connector.gmailDraftChangedNoRetry":
    "The draft changed after GoAhead showed it. Nothing was sent. The draft stays in Gmail Drafts.",
  "error.connector.gmailDraftUnreadable": "GoAhead could not read the draft. Nothing was sent.",
  "error.connector.googleTooManyApprovals":
    "{limit} Google approvals already wait. Ask the GoAhead user to approve or decline some of them first.",
  "error.connector.gmailTooManyRecipients": "A mail can have at most {limit} To addresses and {limit} Cc addresses.",
  "error.connector.gmailSubjectTooLong": "The subject can have at most {limit} characters.",
  "error.connector.googleMailNoticeGone": "This mail card is no longer open. GoAhead did nothing.",
  "error.connector.gmailSendUncertain": "Gmail may have sent the mail: {detail}. Check Sent in Gmail.",
  "error.connector.bitwardenFailed":
    "Could not read Bitwarden. Install the bw CLI, sign in, unlock it, and create one folder named Shared with OpenBot. Connect with a new session key.",
});
