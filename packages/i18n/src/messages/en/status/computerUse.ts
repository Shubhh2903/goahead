import { defineMessages } from "../../../message";

export const messages = defineMessages("status.computerUse", {
  "status.computerUse.driverNotStarted": "The Computer Use driver did not start. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "The Computer Use driver stopped before it could answer.",
  "status.computerUse.driverNoAnswer": "The Computer Use driver did not answer. {reason}",
  "status.computerUse.driverStopped": "The Computer Use driver stopped.",
  "status.computerUse.unsupported": "Computer Use is available on macOS, Windows and Linux.",
  "status.computerUse.driverMissing": "This build of GoAhead carries no Computer Use driver.",
  "status.computerUse.inputRefused":
    "On this desktop, GoAhead cannot type or click in other apps. For tasks on websites, ask the agent to use the GoAhead browser.",
  "status.computerUse.progressActing": "Using an app on this computer…",
  "status.computerUse.progressDeciding": "Deciding the next step in the app…",
});
