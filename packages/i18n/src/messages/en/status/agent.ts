import { defineMessages } from "../../../message";

export const messages = defineMessages("status.agent", {
  "status.agent.claudeWriteOutside":
    "Write {path}, outside the agent's workspace, the shared folder and the temporary folders.",
  "status.agent.contextCleared": "Context cleared. A new chat starts here.",
  "status.agent.marketplaceSuggested": "Suggested a Marketplace app: {app}.",
  "status.agent.turnLimitReached":
    "This turn stopped at its limit after {calls} tool calls and {tokens} processed tokens. Allow continues the work. Deny keeps it stopped.",
  "status.agent.turnLimitContinue": "Continue the work from where you stopped.",
  "status.agent.installGuardRequest":
    "The agent wants to run a command that can download or install many gigabytes:\n{command}\nAllow lets this agent run commands of this kind for 60 minutes. Deny does not run it.",
  "status.agent.installGuardDenied":
    "The person did not allow this command, because it can download or install many gigabytes. Do not run it again. To test on iOS, list the installed simulators with `xcrun simctl list devices available`. Boot one with `xcrun simctl boot <id>` and use it. To test on Android, list the installed emulators with `emulator -list-avds` and start one. If none is suitable, ask the person.",
  "status.agent.installGuardContinue":
    "The person allowed this command. Run it again, then continue the work from where you stopped:\n{command}",
});
