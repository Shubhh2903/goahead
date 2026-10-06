import { defineMessages } from "../../message";

export const messages = defineMessages("messaging", {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack no longer accepts GoAhead in this workspace. It may have been uninstalled. Connect the workspace again.",
  "messaging.help.secret_storage_unavailable":
    "GoAhead cannot read the saved tokens on this computer. Disconnect the workspace, then connect it again.",
  "messaging.help.relay_unavailable":
    "GoAhead cannot receive Slack events on this computer. Sign in, give this computer a name in Server settings, and keep GoAhead open.",
});
