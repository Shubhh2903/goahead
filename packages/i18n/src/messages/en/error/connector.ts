import { defineMessages } from "../../../message";

export const messages = defineMessages("error.connector", {
  "error.connector.githubUnavailable": "This build of GoAhead has no GitHub App.",
  "error.connector.githubDenied": "The GitHub sign-in was refused.",
  "error.connector.githubCodeExpired": "The GitHub code expired. Connect GitHub again.",
  "error.connector.githubDeviceFlowDisabled": "The GitHub App does not allow device sign-in.",
  "error.connector.githubClientUnknown": "GitHub does not know the Client ID of this GitHub App.",
  "error.connector.githubUnexpected": "GitHub sent an unexpected answer: {detail}",
  "error.connector.githubUnreachable": "GoAhead cannot reach GitHub: {detail}",
  "error.connector.githubOffline":
    "GoAhead cannot reach GitHub. Check the internet connection and the DNS settings of the computer or server that runs GoAhead, then try again.",
  "error.connector.githubExpired": "The GitHub connection expired. Connect GitHub again.",
  "error.connector.githubFileUnreadable": "The GitHub connection file is unreadable.",
  "error.connector.githubFileTooLarge": "The GitHub connection file is too large.",
  "error.connector.linkDenied": "The Link sign-in was refused.",
  "error.connector.linkCodeExpired": "The Link sign-in expired. Connect Link again.",
  "error.connector.linkUnexpected": "Link sent an unexpected answer: {detail}",
  "error.connector.linkUnreachable": "GoAhead cannot reach Link: {detail}",
  "error.connector.linkExpired": "The Link connection expired. Connect Link again.",
  "error.connector.linkNotConnected": "Link is not connected. Connect it in Server settings > Vault > Cards.",
  "error.connector.linkNoCard": "The Link account has no card. Add a card in Link.",
  "error.connector.linkFileUnreadable": "The Link connection file is unreadable.",
  "error.connector.linkFileTooLarge": "The Link connection file is too large.",
  "error.connector.onePasswordCliMissing":
    "GoAhead cannot find the 1Password CLI. Install it and turn on its integration in the 1Password app, or use a service account token.",
  "error.connector.onePasswordCliInstallFailed":
    "GoAhead could not install the 1Password CLI. Check the connection to the internet, then try again.",
  "error.connector.onePasswordCliSignedOut":
    "The 1Password CLI is not signed in. Turn on its integration in the 1Password app, then connect again.",
  "error.connector.onePasswordAppUnreachable":
    "GoAhead cannot reach the 1Password app. Open 1Password and unlock it. In Settings > Developer, make sure that “Integrate with 1Password CLI” is on. Then try again.",
  "error.connector.onePasswordCliFailed": "The 1Password CLI failed: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Your 1Password account does not let you create the shared vault or a service account. Ask an owner or administrator of the account for this permission, or ask them for a service account token and click “Use token”.",
  "error.connector.onePasswordUnexpected": "1Password sent an unexpected answer: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password did not accept the service account token.",
  "error.connector.onePasswordUnreachable":
    "GoAhead cannot reach 1Password. Check the internet connection, then try again.",
  "error.connector.onePasswordRateLimited": "1Password received too many requests. Wait a few minutes, then try again.",
  "error.connector.onePasswordNoVault":
    "The service account cannot read a vault. Give it access to a vault, then try again.",
  "error.connector.onePasswordReadFailed":
    "GoAhead cannot read your logins in 1Password. Disconnect 1Password, then connect it again.",
  "error.connector.onePasswordFileUnreadable": "The 1Password connection file is unreadable.",
  "error.connector.onePasswordFileTooLarge": "The 1Password connection file is too large.",
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
  "error.connector.bitwardenCliMissing":
    "GoAhead cannot find the Bitwarden CLI. Install bw, make sure that it works in a new terminal, then connect again.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden must have exactly one folder named Shared with OpenBot. Create it or remove the extra one, then connect again.",
  "error.connector.bitwardenHostInput":
    "Enter an HTTPS server address, the API key client_id and client_secret, and the master password.",
  "error.connector.bitwardenHostFailed":
    "Could not open Bitwarden on this server. Check the server address, the API key and the master password, and make sure that one folder is named Shared with OpenBot. Then connect again.",
  "error.connector.bitwardenHostSignInFailed":
    "Could not sign in to Bitwarden on this server. Check the server address and the API key, then connect again.",
  "error.connector.bitwardenHostUnlockFailed":
    "Could not unlock Bitwarden on this server. Check the master password, then connect again.",
  "error.connector.bitwardenCliInstallFailed":
    "Could not install the Bitwarden CLI on this server. Check its network connection, then connect again.",
  "error.connector.bitwardenFileUnreadable": "The Bitwarden connection file is unreadable.",
  "error.connector.passwordManagerUnknown": "GoAhead does not know this password manager.",
  "error.connector.passwordManagerMethod": "This password manager cannot connect this way.",
  "error.connector.passwordManagerNoSignIn": "No sign-in page is open. Connect again.",
  "error.connector.protonPassFailed": "Could not connect Proton Pass. Connect again.",
  "error.connector.protonPassCliInstallFailed":
    "Could not install the Proton Pass CLI. Check the network connection, then connect again.",
  "error.connector.protonPassPlan":
    "Your Proton plan does not allow the Proton Pass CLI. Change the plan, then connect again.",
  "error.connector.protonPassPlanMissing":
    "Your Proton plan does not include the Proton Pass CLI. It needs a Proton plan that includes Pass Plus. Change the plan, then connect again.",
  "error.connector.protonPassExpired": "The Proton Pass access ended. Connect again.",
  "error.connector.protonPassKeyInvalid": "Enter a Proton Pass access key that starts with pst_.",
  "error.connector.protonPassExtraPassword": "The extra password is not correct. Enter it again.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass did not ask for an extra password.",
  "error.connector.protonPassFileUnreadable": "The Proton Pass connection file is unreadable.",
  "error.connector.protonPassSignInTimeout": "The Proton sign-in took too long. Connect again.",
  "error.connector.protonPassSetupFailed":
    "Could not make the vault Shared with OpenBot or its access key in Proton Pass. Connect again.",
});
