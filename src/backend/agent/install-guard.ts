import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isRecord } from "../protocol";

/**
 * A command that can download or install gigabytes: a simulator, a simulator runtime, an Xcode
 * platform, Android SDK packages, an Android virtual device, or CocoaPods. The host asks the person
 * at this computer before an agent runs one.
 */
export type InstallGuardRule =
  | "simulator-create"
  | "simulator-runtime"
  | "xcode-platform"
  | "android-sdk"
  | "android-avd"
  | "cocoapods";

/**
 * The server request with which the Claude client asks the host before a guarded Bash command:
 * `{ threadId, turnId, command, rule }`, answered with `{ decision: "accept" | "decline" }`.
 */
export const INSTALL_GUARD_METHOD = "openbot/installGuard";

const INSTALL_GUARD_RULES: ReadonlySet<string> = new Set<InstallGuardRule>([
  "simulator-create",
  "simulator-runtime",
  "xcode-platform",
  "android-sdk",
  "android-avd",
  "cocoapods",
]);

export function isInstallGuardRule(value: unknown): value is InstallGuardRule {
  return isString(value) && INSTALL_GUARD_RULES.has(value);
}

/** How long Allow on an install card lets the agent run commands of the same rule. */
export const INSTALL_ALLOWANCE_MS = 60 * 60_000;

/** Programs that run the next word as the command. Their own options start with `-`. */
const WRAPPERS = new Set(["sudo", "env", "command", "exec", "nohup", "time", "nice", "arch"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const SDKMANAGER_QUERIES = new Set(["--list", "--list_installed", "--licenses", "--version", "--help", "--uninstall"]);

/**
 * The rule that a shell command matches, or null. Each simple command of the line (split at `&&`,
 * `||`, `;`, `|`, `&`, parentheses and new lines) is read from its program, after `sudo`, `env`,
 * variable assignments and `bundle exec`. A quoted text is one word, so a command that only names
 * `pod install` in the arguments of another program, such as `echo` or `grep`, does not match. The
 * script of `sh -c` is read as a command line too: Codex runs its commands that way.
 */
export function guardedInstall(command: string): InstallGuardRule | null {
  for (const words of simpleCommands(command)) {
    const rule = commandRule(words);
    if (rule) return rule;
  }
  return null;
}

/**
 * The command text of a provider tool item, or null for any other item: the `command` of a Codex
 * `commandExecution`, or the raw input of an ACP `execute` tool call (Grok sends `{ command }`).
 * An argument list is joined with shell quotes.
 */
export function providerCommandText(item: DynamicRecord): string | null {
  if (item.type === "commandExecution") return commandValue(item.command);
  if (item.type === "toolCall" && item.toolKind === "execute") {
    const input = item.arguments;
    if (!isRecord(input)) return commandValue(input);
    return commandValue(input.command) ?? commandValue(input.cmd);
  }
  return null;
}

/** The rules that the person allowed, for each agent, for `INSTALL_ALLOWANCE_MS`. Memory only. */
export class InstallAllowances {
  readonly #expiresAt = new Map<string, number>();

  allow(agentId: string, rule: InstallGuardRule, now: number): void {
    this.#expiresAt.set(allowanceKey(agentId, rule), now + INSTALL_ALLOWANCE_MS);
  }

  isAllowed(agentId: string, rule: InstallGuardRule, now: number): boolean {
    const expiresAt = this.#expiresAt.get(allowanceKey(agentId, rule));
    if (expiresAt === undefined) return false;
    if (now < expiresAt) return true;
    this.#expiresAt.delete(allowanceKey(agentId, rule));
    return false;
  }
}

function allowanceKey(agentId: string, rule: InstallGuardRule): string {
  return `${agentId}\u0000${rule}`;
}

function commandValue(value: unknown): string | null {
  if (isString(value)) return value;
  if (Array.isArray(value) && value.length > 0 && value.every(isString)) return value.map(shellQuote).join(" ");
  return null;
}

function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

function commandRule(words: string[]): InstallGuardRule | null {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    const program = baseName(word);
    if (/^[A-Za-z_]\w*=/u.test(word)) index += 1;
    else if (WRAPPERS.has(program)) index = skipOptions(words, index + 1);
    else if (program === "bundle" && words[index + 1] === "exec") index += 2;
    else break;
  }
  const program = baseName(words[index] ?? "");
  const args = words.slice(index + 1);
  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (SHELLS.has(program)) {
    const scriptIndex = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/u.test(arg)) + 1;
    const script = scriptIndex > 0 ? args.slice(scriptIndex).find((arg) => !arg.startsWith("-")) : undefined;
    return script === undefined ? null : guardedInstall(script);
  }
  if (program === "xcrun" || program === "simctl") {
    const simctl = program === "simctl" ? positional : positional.slice(positional.indexOf("simctl") + 1);
    if (program === "xcrun" && !positional.includes("simctl")) return null;
    if (simctl[0] === "create") return "simulator-create";
    if (simctl[0] === "runtime" && simctl[1] === "add") return "simulator-runtime";
    return null;
  }
  if (program === "xcodebuild") {
    return args.some((arg) => arg === "-downloadPlatform" || arg === "-downloadAllPlatforms") ? "xcode-platform" : null;
  }
  if (program === "sdkmanager") {
    if (args.includes("--install") || args.includes("--update")) return "android-sdk";
    if (args.some((arg) => SDKMANAGER_QUERIES.has(arg))) return null;
    return positional.length > 0 ? "android-sdk" : null;
  }
  if (program === "avdmanager") return positional[0] === "create" ? "android-avd" : null;
  if (program === "pod") {
    if (positional[0] === "install") return "cocoapods";
    if (positional[0] === "repo" && positional[1] === "update") return "cocoapods";
  }
  return null;
}

function skipOptions(words: string[], index: number): number {
  let next = index;
  while ((words[next] ?? "").startsWith("-")) next += 1;
  return next;
}

function baseName(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

/**
 * The simple commands of a shell line, each as its words with the quotes removed. A quote that does
 * not close runs to the end of the line. Substitutions and redirections are kept as words: no rule
 * reads them.
 */
function simpleCommands(line: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === "'") {
      const end = line.indexOf("'", index + 1);
      const close = end === -1 ? line.length : end;
      word += line.slice(index + 1, close);
      inWord = true;
      index = close;
    } else if (char === '"') {
      inWord = true;
      for (index += 1; index < line.length && line[index] !== '"'; index += 1) {
        if (line[index] === "\\" && index + 1 < line.length && '"\\$`'.includes(line[index + 1] ?? "")) index += 1;
        word += line[index] ?? "";
      }
    } else if (char === "\\") {
      index += 1;
      if (index < line.length && line[index] !== "\n") {
        word += line[index];
        inWord = true;
      }
    } else if (";&|()\n".includes(char)) {
      endCommand();
    } else if (/\s/u.test(char)) {
      endWord();
    } else {
      word += char;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}
