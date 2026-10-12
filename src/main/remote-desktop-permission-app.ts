import type { RemoteDesktopPermissionApp } from "@openbot/contracts/ipc";

/**
 * macOS checks Screen Recording and Accessibility for the responsible app, not for Sunshine. In a
 * packaged build that is GoAhead. A development build is responsible to the app that started it,
 * such as Terminal. Only known apps get a name; every other one is `development`.
 */
export function remoteDesktopPermissionApp(
  packaged: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): RemoteDesktopPermissionApp {
  if (packaged) return "goahead";
  // LaunchServices sets the bundle id of the app that started the shell. Other editors set the same
  // TERM_PROGRAM as Visual Studio Code, so only the bundle id names it.
  switch (environment.__CFBundleIdentifier) {
    case "com.apple.Terminal":
      return "terminal";
    case "com.googlecode.iterm2":
      return "iterm";
    case "com.microsoft.VSCode":
      return "vscode";
  }
  switch (environment.TERM_PROGRAM) {
    case "Apple_Terminal":
      return "terminal";
    case "iTerm.app":
      return "iterm";
    default:
      return "development";
  }
}
