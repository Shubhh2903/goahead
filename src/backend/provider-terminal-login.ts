import { type ChildProcess, spawn } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { waitForSuccessfulProcess } from "./agent/provider-status";
import type { AgentCliInfo } from "./cli";

// One AppleScript opens the tab, waits until its command exits, and closes only that tab. The
// TTY names the tab this sign-in opened, so other windows and tabs stay open.
const TERMINAL_MAC = `on run argv
  tell application "Terminal"
    activate
    set loginTab to do script (item 1 of argv)
    set loginTty to tty of loginTab
    delay 0.5
    repeat
      set foundBusy to false
      repeat with candidateWindow in windows
        repeat with candidateTab in tabs of candidateWindow
          if tty of candidateTab is loginTty then
            if busy of candidateTab then set foundBusy to true
          end if
        end repeat
      end repeat
      if not foundBusy then exit repeat
      delay 0.2
    end repeat
    repeat with candidateWindow in windows
      repeat with candidateTab in tabs of candidateWindow
        if tty of candidateTab is loginTty then
          close candidateTab
          return
        end if
      end repeat
    end repeat
  end tell
end run`;

/** The path comes from the CLI resolver. Quote it as one shell word, including embedded apostrophes. */
function terminalLoginCommand(executable: string): string {
  return `'${executable.replaceAll("'", "'\\''")}'`;
}

/**
 * Opens the provider CLI in a terminal on the host, for a sign-in that only the CLI's own
 * interactive screen offers (Pi `/login`). `done` resolves when the user closes the CLI, and the
 * provider runtime then reads the account again. The caller stops `child` to cancel.
 */
export function startProviderTerminalLogin(
  cli: AgentCliInfo,
  timeoutMs: number,
): { child: ChildProcess; done: Promise<void> } {
  const child =
    process.platform === "darwin"
      ? spawn("/usr/bin/osascript", ["-e", TERMINAL_MAC, terminalLoginCommand(cli.executable)], { stdio: "ignore" })
      : process.platform === "win32"
        ? spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "$p = Start-Process -FilePath $env:OPENBOT_LOGIN_EXECUTABLE -Wait -PassThru; exit $p.ExitCode",
            ],
            { stdio: "ignore", windowsHide: true, env: { ...process.env, OPENBOT_LOGIN_EXECUTABLE: cli.executable } },
          )
        : spawn("xterm", ["-e", cli.executable], { stdio: "ignore" });
  const done = waitForSuccessfulProcess(child, timeoutMs, "Provider sign-in terminal").catch(() => {
    throw new Error(sourceText("error.provider.terminalLoginFailed"));
  });
  return { child, done };
}
