import { statSync } from "node:fs";
import type { AgentProjectFolder, AgentProjectFolderState, AgentSummary } from "@openbot/contracts/ipc";

/** The most entries the Slack Orchestrator's project map lists, to keep its prompt short. */
export const PROJECT_MAP_LIMIT = 50;

/** True when the path is a folder on this computer now. */
export function isExistingFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The agent's project folders that still exist. A turn skips the others, with no error. */
export function existingProjectFolders(agent: Pick<AgentSummary, "projectFolders">): AgentProjectFolder[] {
  return (agent.projectFolders ?? []).filter((folder) => isExistingFolder(folder.path));
}

/** The folders as the settings panel shows them, each marked when it no longer exists. */
export function projectFolderStates(folders: readonly AgentProjectFolder[]): AgentProjectFolderState[] {
  return folders.map((folder) => ({ ...folder, missing: !isExistingFolder(folder.path) }));
}

/** The line of the agent's instructions that names its project folders, or null when it has none. */
export function projectFoldersInstruction(folders: readonly AgentProjectFolder[]): string | null {
  if (folders.length === 0) return null;
  return `Project folders: ${folders.map((folder) => `${folder.name} → ${folder.path}`).join("; ")}.`;
}

/**
 * The map of every local agent's existing project folders, for the Slack Orchestrator, so it gives
 * "do X in <project>" to the agent that owns the project. Read on each turn, so it is never stale.
 */
export function projectMapLine(agents: readonly Pick<AgentSummary, "name" | "projectFolders">[]): string | null {
  const entries: string[] = [];
  for (const agent of agents) {
    for (const folder of agent.projectFolders ?? []) {
      if (isExistingFolder(folder.path)) entries.push(`${folder.name} → ${agent.name} (${folder.path})`);
      if (entries.length >= PROJECT_MAP_LIMIT) return `Projects: ${entries.join("; ")}.`;
    }
  }
  return entries.length ? `Projects: ${entries.join("; ")}.` : null;
}
