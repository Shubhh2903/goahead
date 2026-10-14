import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/**
 * The settings sources of an agent session. GoAhead does not load the user source
 * (`~/.claude/settings.json`, `~/.claude/skills`, `~/.claude/agents`, `~/.claude/CLAUDE.md`), so the
 * personal plugins, skills, subagents and hooks of the user's own Claude Code do not go into each
 * agent. The project and local settings of the agent's workspace still load. Workspace only loads
 * no source: see `claude-workspace-sandbox.ts`.
 */
export function claudeSettingSources(workspaceOnly: boolean): NonNullable<Options["settingSources"]> {
  return workspaceOnly ? [] : ["project", "local"];
}

type ClaudeFlagSettings = Exclude<Options["settings"], string | undefined>;

/** The user settings that an agent session still needs without the user source. */
export interface ClaudeUserCarryOver {
  /** The `env` of the user settings. It goes to the process environment, not to the command line. */
  env: Record<string, string>;
  /** The commands that get credentials, for a user who signs in through them and not with `claude auth login`. */
  settings: ClaudeFlagSettings | null;
}

const CREDENTIAL_HELPERS = [
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "proxyAuthHelper",
] as const;

/**
 * Reads the parts of the user settings that are not plugins, skills, subagents or hooks and that an
 * agent cannot start without: the environment (a provider such as Bedrock, a base URL, a proxy) and
 * the credential helper commands. The Claude sign-in is not in this file: Claude keeps it in the
 * keychain or in `.credentials.json`, which every setting source reads. A missing or unreadable
 * file gives nothing, as it does for Claude.
 */
export async function readClaudeUserCarryOver(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeUserCarryOver> {
  const directory = environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
  } catch {
    // Claude itself starts without a settings file it cannot read, so a session does too.
    return { env: {}, settings: null };
  }
  if (!isDynamicRecord(parsed)) return { env: {}, settings: null };
  const env: Record<string, string> = {};
  if (isDynamicRecord(parsed.env)) {
    for (const [key, value] of Object.entries(parsed.env)) if (isString(value)) env[key] = value;
  }
  const settings: ClaudeFlagSettings = {};
  for (const key of CREDENTIAL_HELPERS) {
    const value = parsed[key];
    if (isString(value) && value !== "") settings[key] = value;
  }
  return { env, settings: Object.keys(settings).length > 0 ? settings : null };
}
