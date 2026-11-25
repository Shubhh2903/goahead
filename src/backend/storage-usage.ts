// Storage and files: what the host keeps on disk, measured for the Storage tab, the agent Files
// detail and the chat Files panel. Files come from the mailbox state and their chats from the
// database; folders are walked with a bound. Nothing here follows a symbolic link, and nothing here
// deletes outside the cache and log folders the caller names. A folder with no agent under a managed
// workspace root goes to the Trash only through the caller's function, after the checks here.

import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, rm, statfs } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentStorageRow,
  CLEARABLE_STORAGE_CATEGORIES,
  type ClearableStorageCategory,
  type ConversationStorageRow,
  type GetStorageUsageInput,
  STORAGE_LIMITS,
  type StorageBreakdown,
  type StorageCategory,
  type StorageUsage,
  type StoredFileRow,
  UNASSIGNED_FOLDER_LIMIT,
  type UnassignedFolder,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import {
  type StoragePlacement,
  type StorageThread,
  storagePlacementPage,
  storageThreadSize,
  storageThreads,
} from "./database/storage-usage-queries";
import type { MailboxStore, MailboxStoredFile } from "./mailbox-store";
import { isWithin } from "./workspace-paths";

export interface StorageRoots {
  /** The SQLite file. Its `-wal` and `-shm` companions are counted with it. */
  database: string;
  /** The current and the legacy parent folders of managed agent workspaces. */
  workspaceRoots: readonly string[];
  downloads: string;
  /** Folders of copies the app can download again. Clear removes what is in them. */
  caches: readonly string[];
  /** Folders of rotated log files. Only `*.log` and `*.log.N` files directly in them count. */
  logs: readonly string[];
  runtimes: string | null;
  /** A path on the disk that holds the host data, for the free space. */
  data: string;
}

export interface StorageAgent {
  id: string;
  workspacePath: string;
  /** Folders the user picked for the agent to work in. Never offered for the Trash, nor a folder that holds one. */
  projectFolders?: readonly { path: string }[];
}

export interface StorageUsageSources {
  roots: StorageRoots;
  database: () => DatabaseSync;
  mailbox: Pick<MailboxStore, "listStoredFiles" | "deleteStoredFile">;
  agents: () => readonly StorageAgent[];
}

/** One host scan: the answer every surface reads, and the local-only folders with no agent. */
export interface StorageScan {
  usage: StorageUsage;
  /** Largest first. Empty for an agent or a chat scope. */
  unassignedFolders: UnassignedFolder[];
}

/** The request names an agent or a file the host does not have. The Team API answers 404. */
export class StorageNotFoundError extends Error {}

/** A folder with more entries than this counts what it reached and marks the result truncated. */
const STORAGE_WALK_ENTRY_LIMIT = 100_000;
const STAT_BATCH = 64;
const LOG_FILE = /\.log(\.\d+)?$/;
const CACHE_TTL_MS = 60_000;
/**
 * A folder with no agent in this profile in which a file changed this recently is not offered for
 * the Trash: another GoAhead profile or OpenBot install on this computer shares the Agents folder,
 * and its agents can still work there.
 */
export const UNASSIGNED_FOLDER_QUIET_MS = 7 * 24 * 60 * 60_000;
/** An unfinished copy of a workspace. The agent store finishes or removes it. */
const STAGE_SUFFIX = ".openbot-stage";

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

interface TreeSize {
  bytes: number;
  complete: boolean;
  /** The newest modification time of a regular file under the root, in epoch milliseconds; 0 with no file. */
  newestModifiedMs: number;
}

/**
 * Bytes of the regular files under `root`, and the newest of their modification times. A symbolic
 * link is never followed, so a workspace that links to a large folder does not count it, and a loop
 * cannot run forever. A folder in `skip` (real paths) is not entered: it is counted with its agent.
 */
async function measureTree(root: string, skip?: ReadonlySet<string>): Promise<TreeSize> {
  let start: string;
  try {
    start = await realpath(root);
    if (!(await lstat(start)).isDirectory()) return { bytes: 0, complete: true, newestModifiedMs: 0 };
  } catch {
    return { bytes: 0, complete: true, newestModifiedMs: 0 };
  }
  const pending = [start];
  let bytes = 0;
  let newestModifiedMs = 0;
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop() ?? start;
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    for (const child of children) {
      if (++entries > STORAGE_WALK_ENTRY_LIMIT) return { bytes, complete: false, newestModifiedMs };
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        if (!skip?.has(path)) pending.push(path);
      } else if (child.isFile()) files.push(path);
    }
    for (let index = 0; index < files.length; index += STAT_BATCH)
      for (const info of await Promise.all(files.slice(index, index + STAT_BATCH).map(fileInfo))) {
        bytes += info.size;
        newestModifiedMs = Math.max(newestModifiedMs, info.modifiedMs);
      }
  }
  return { bytes, complete: true, newestModifiedMs };
}

async function fileInfo(path: string): Promise<{ size: number; modifiedMs: number }> {
  try {
    const info = await lstat(path);
    return info.isFile() ? { size: info.size, modifiedMs: info.mtimeMs } : { size: 0, modifiedMs: 0 };
  } catch {
    return { size: 0, modifiedMs: 0 };
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await lstat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function logFiles(directory: string): Promise<string[]> {
  try {
    const children = await readdir(directory, { withFileTypes: true });
    return children
      .filter((child) => child.isFile() && LOG_FILE.test(child.name))
      .map((child) => join(directory, child.name));
  } catch {
    return [];
  }
}

async function freeBytes(path: string): Promise<number | null> {
  try {
    const filesystem = await statfs(path);
    const free = filesystem.bavail * filesystem.bsize;
    return Number.isSafeInteger(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

/** A wire identifier or nothing, so one odd id drops a link instead of failing the whole answer. */
function wireId(value: string | null | undefined): string | null {
  return value && value.length <= INPUT_LIMITS.identifier ? value : null;
}

interface MeasuredFile {
  stored: MailboxStoredFile;
  placement: StoragePlacement | null;
  /** Every chat of the scope that shows the file. */
  threadIds: ReadonlySet<string>;
  agentId: string | null;
  bytes: number;
  status: "available" | "missing";
  modifiedAt: string | null;
}

function breakdownRow(category: StorageCategory, bytes: number): StorageBreakdown {
  return { category, bytes, removable: isOneOf(CLEARABLE_STORAGE_CATEGORIES, category) };
}

function largestFirst<T extends { bytes: number }>(rows: T[], limit: number): { rows: T[]; cut: boolean } {
  rows.sort((left, right) => right.bytes - left.bytes);
  return { rows: rows.slice(0, limit), cut: rows.length > limit };
}

export class StorageUsageScanner {
  readonly #sources: StorageUsageSources;
  readonly #now: () => number;

  constructor(sources: StorageUsageSources, now: () => number = Date.now) {
    this.#sources = sources;
    this.#now = now;
  }

  async scan(input: GetStorageUsageInput): Promise<StorageUsage> {
    return (await this.measure(input)).usage;
  }

  async measure(input: GetStorageUsageInput): Promise<StorageScan> {
    const scannedAt = new Date().toISOString();
    const agents = this.#sources.agents();
    const scopeAgent = input.agentId === undefined ? null : agents.find((agent) => agent.id === input.agentId);
    if (input.scope === "agent" && !scopeAgent)
      throw new StorageNotFoundError(sourceText("error.storage.agentMissing"));

    const db = this.#sources.database();
    let threads = storageThreads(db, input.agentId);
    if (input.scope === "conversation") threads = threads.filter((thread) => thread.threadId === input.conversationId);
    const threadById = new Map(threads.map((thread) => [thread.threadId, thread]));
    const placements = await this.#placements(db, threadById);
    const files = await this.#measureFiles(input, placements, threadById);
    const threadSizes = new Map<string, { messageCount: number; bytes: number }>();
    for (const thread of threads) {
      threadSizes.set(thread.threadId, storageThreadSize(db, thread.threadId));
      await yieldToEventLoop();
    }

    const filesByThread = new Map<string, MeasuredFile[]>();
    for (const file of files)
      for (const threadId of file.threadIds) {
        const shown = filesByThread.get(threadId);
        if (shown) shown.push(file);
        else filesByThread.set(threadId, [file]);
      }
    let truncated = false;
    const conversations = largestFirst(
      threads.flatMap(
        (thread) => this.#conversationRow(thread, threadSizes, filesByThread.get(thread.threadId) ?? []) ?? [],
      ),
      STORAGE_LIMITS.conversations,
    );
    const fileRows = largestFirst(
      files.map((file) => ({ bytes: file.bytes, row: this.#fileRow(file, threadById, scannedAt) })),
      STORAGE_LIMITS.files,
    );
    truncated ||= conversations.cut || fileRows.cut;

    const sum = (source: MailboxStoredFile["source"]) =>
      uniqueBytes(files.filter((file) => file.stored.source === source));
    const chatBytes = [...threadSizes.values()].reduce((total, size) => total + size.bytes, 0);
    let breakdown: StorageBreakdown[];
    let agentRows: AgentStorageRow[] = [];
    let unassignedFolders: UnassignedFolder[] = [];
    if (input.scope === "host") {
      const measured = await this.#hostFolders(agents);
      truncated ||= !measured.complete;
      breakdown = [
        breakdownRow("workspaces", measured.workspaces),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", await this.#databaseBytes()),
        breakdownRow("downloads", measured.downloads),
        breakdownRow("caches", measured.caches),
        breakdownRow("runtimes", measured.runtimes),
        breakdownRow("logs", measured.logs),
      ];
      const agentList = largestFirst(
        agents.flatMap((agent) => {
          const id = wireId(agent.id);
          if (!id) return [];
          return [this.#agentRow(id, measured.byWorkspace.get(agent.workspacePath) ?? 0, files, threads, threadSizes)];
        }),
        STORAGE_LIMITS.agents,
      );
      agentRows = agentList.rows;
      truncated ||= agentList.cut;
      unassignedFolders = largestFirst(measured.unassignedFolders, UNASSIGNED_FOLDER_LIMIT).rows;
    } else if (input.scope === "agent" && scopeAgent) {
      const workspace = await measureTree(scopeAgent.workspacePath);
      truncated ||= !workspace.complete;
      breakdown = [
        breakdownRow("workspaces", workspace.bytes),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", chatBytes),
      ];
      agentRows = [this.#agentRow(scopeAgent.id, workspace.bytes, files, threads, threadSizes)];
    } else {
      breakdown = [
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", chatBytes),
      ];
    }

    const usage: StorageUsage = {
      scope: input.scope,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      scannedAt,
      freeBytes: await freeBytes(this.#sources.roots.data),
      breakdown,
      agents: agentRows,
      conversations: conversations.rows,
      files: fileRows.rows.map((entry) => entry.row),
      truncated,
    };
    return { usage, unassignedFolders };
  }

  /** Placements in the scope's chats, by attachment id. Paged, with a yield between pages. */
  async #placements(
    db: DatabaseSync,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Promise<Map<string, StoragePlacement[]>> {
    const byAttachment = new Map<string, StoragePlacement[]>();
    if (threadById.size === 0) return byAttachment;
    let afterId: string | null = "";
    while (afterId !== null) {
      const page = storagePlacementPage(db, afterId);
      for (const placement of page.placements) {
        if (!threadById.has(placement.threadId)) continue;
        const list = byAttachment.get(placement.attachmentId);
        if (list) list.push(placement);
        else byAttachment.set(placement.attachmentId, [placement]);
      }
      afterId = page.nextId;
      await yieldToEventLoop();
    }
    return byAttachment;
  }

  async #measureFiles(
    input: GetStorageUsageInput,
    placements: ReadonlyMap<string, StoragePlacement[]>,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Promise<MeasuredFile[]> {
    const seen = new Set<string>();
    const selected: Omit<MeasuredFile, "bytes" | "status" | "modifiedAt">[] = [];
    for (const stored of this.#sources.mailbox.listStoredFiles()) {
      if (seen.has(stored.attachment.id)) continue;
      const shown = [...(placements.get(stored.attachment.id) ?? [])].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const inScope =
        input.scope === "host" || shown.length > 0 || (input.scope === "agent" && stored.agentId === input.agentId);
      if (!inScope) continue;
      seen.add(stored.attachment.id);
      const placement = shown[0] ?? null;
      const placementAgent = placement ? (threadById.get(placement.threadId)?.agentId ?? null) : null;
      selected.push({
        stored,
        placement,
        threadIds: new Set(shown.map((entry) => entry.threadId)),
        agentId: input.scope === "agent" ? (input.agentId ?? null) : (placementAgent ?? stored.agentId),
      });
    }
    const measured: MeasuredFile[] = [];
    for (let index = 0; index < selected.length; index += STAT_BATCH) {
      const batch = selected.slice(index, index + STAT_BATCH);
      const infos = await Promise.all(batch.map((file) => lstat(file.stored.path).catch(() => null)));
      batch.forEach((file, offset) => {
        const info = infos[offset];
        const available = info?.isFile() === true;
        measured.push({
          ...file,
          bytes: available ? info.size : 0,
          status: available ? "available" : "missing",
          modifiedAt: available ? info.mtime.toISOString() : null,
        });
      });
    }
    return measured;
  }

  #fileRow(file: MeasuredFile, threadById: ReadonlyMap<string, StorageThread>, scannedAt: string): StoredFileRow {
    const thread = file.placement ? threadById.get(file.placement.threadId) : undefined;
    const conversationId = wireId(thread?.threadId);
    const messageId = conversationId ? wireId(file.placement?.messageId) : null;
    return {
      ...file.stored.attachment,
      source: file.stored.source,
      agentId: wireId(file.agentId),
      conversation:
        thread && conversationId ? { id: conversationId, title: thread.title.slice(0, STORAGE_LIMITS.title) } : null,
      messageId,
      createdAt: file.stored.createdAt ?? file.placement?.createdAt ?? file.modifiedAt ?? scannedAt,
      status: file.status,
      deletable: true,
    };
  }

  #conversationRow(
    thread: StorageThread,
    threadSizes: ReadonlyMap<string, { messageCount: number; bytes: number }>,
    shown: readonly MeasuredFile[],
  ): ConversationStorageRow | null {
    const id = wireId(thread.threadId);
    const agentId = wireId(thread.agentId);
    if (!id || !agentId) return null;
    const size = threadSizes.get(thread.threadId) ?? { messageCount: 0, bytes: 0 };
    return {
      id,
      title: thread.title.slice(0, STORAGE_LIMITS.title),
      agentId,
      bytes: size.bytes + uniqueBytes(shown),
      fileCount: shown.length,
      messageCount: size.messageCount,
    };
  }

  #agentRow(
    agentId: string,
    workspaceBytes: number,
    files: readonly MeasuredFile[],
    threads: readonly StorageThread[],
    threadSizes: ReadonlyMap<string, { bytes: number }>,
  ): AgentStorageRow {
    const chats = threads.filter((thread) => thread.agentId === agentId);
    // The same rule as the agent scope: a file shown in two agents' chats counts for both.
    const owned = files.filter((file) =>
      file.threadIds.size === 0
        ? file.agentId === agentId
        : chats.some((thread) => file.threadIds.has(thread.threadId)),
    );
    const chatBytes = chats.reduce((total, thread) => total + (threadSizes.get(thread.threadId)?.bytes ?? 0), 0);
    return {
      agentId,
      bytes: workspaceBytes + uniqueBytes(owned) + chatBytes,
      fileCount: owned.length,
      conversationCount: chats.length,
    };
  }

  async #databaseBytes(): Promise<number> {
    const path = this.#sources.roots.database;
    const sizes = await Promise.all([path, `${path}-wal`, `${path}-shm`].map(fileSize));
    return sizes.reduce((total, size) => total + size, 0);
  }

  async #hostFolders(agents: readonly StorageAgent[]) {
    const roots = this.#sources.roots;
    let complete = true;
    const measureSize = async (path: string, skip?: ReadonlySet<string>) => {
      const size = await measureTree(path, skip);
      complete &&= size.complete;
      return size;
    };
    const measure = async (path: string, skip?: ReadonlySet<string>) => (await measureSize(path, skip)).bytes;
    // Two agents can share a workspace folder, by one path or by two; the disk holds it once.
    const byWorkspace = new Map<string, number>();
    const byRealPath = new Map<string, number>();
    for (const path of new Set(agents.map((agent) => agent.workspacePath))) {
      const real = await realpath(path).catch(() => null);
      if (!real) {
        byWorkspace.set(path, 0);
        continue;
      }
      const bytes = byRealPath.get(real) ?? (await measure(real));
      byRealPath.set(real, bytes);
      byWorkspace.set(path, bytes);
    }
    const registered = new Set(byRealPath.keys());
    const inUse = [...registered, ...(await realProjectFolders(agents))];
    const unassigned = await this.#unassignedFolders(agents, registered, inUse, measureSize);
    let caches = 0;
    for (const path of roots.caches) caches += await measure(path);
    let logs = 0;
    for (const directory of roots.logs)
      for (const size of await Promise.all((await logFiles(directory)).map(fileSize))) logs += size;
    return {
      byWorkspace,
      workspaces: [...byRealPath.values()].reduce((total, bytes) => total + bytes, 0) + unassigned.bytes,
      unassignedFolders: unassigned.folders,
      downloads: await measure(roots.downloads),
      caches,
      runtimes: roots.runtimes ? await measure(roots.runtimes) : 0,
      logs,
      complete,
    };
  }

  /**
   * What sits under a managed workspace root and is not a registered workspace: a folder an agent
   * made beside its own, a copy left by an import, a QA run. Its bytes count as workspaces. A folder
   * is offered for the Trash only when no agent of this profile owns it, no agent workspace is inside
   * it, and no file in it changed for `UNASSIGNED_FOLDER_QUIET_MS`: another profile or install can
   * share the root. A folder too large to walk to the end is not offered.
   */
  async #unassignedFolders(
    agents: readonly StorageAgent[],
    registered: ReadonlySet<string>,
    inUse: readonly string[],
    measure: (path: string, skip?: ReadonlySet<string>) => Promise<TreeSize>,
  ): Promise<{ bytes: number; folders: UnassignedFolder[] }> {
    let bytes = 0;
    const folders: UnassignedFolder[] = [];
    for (const root of new Set(this.#sources.roots.workspaceRoots)) {
      const real = await realDirectory(root);
      // A root inside a registered workspace is already counted with that agent.
      if (!real || [...registered].some((workspace) => workspace === real || isWithin(workspace, real))) continue;
      let children: Dirent[];
      try {
        children = await readdir(real, { withFileTypes: true });
      } catch {
        continue;
      }
      const owned = new Set(ownedWorkspacePaths([real], agents));
      for (const child of children) {
        const path = join(real, child.name);
        if (child.isFile()) bytes += await fileSize(path);
        if (!child.isDirectory() || registered.has(path)) continue;
        const inside = new Set([...registered].filter((workspace) => isWithin(path, workspace)));
        const size = await measure(path, inside);
        bytes += size.bytes;
        if (
          inside.size === 0 &&
          !owned.has(path) &&
          canTrashUnassignedFolder(path, [real], inUse) &&
          quietFolder(size, this.#now())
        )
          folders.push({ path: join(root, child.name), bytes: size.bytes });
      }
    }
    return { bytes, folders };
  }
}

/** A folder walked to the end in which no file changed for `UNASSIGNED_FOLDER_QUIET_MS`. */
function quietFolder(size: TreeSize, now: number): boolean {
  return size.complete && now - size.newestModifiedMs >= UNASSIGNED_FOLDER_QUIET_MS;
}

/** The real path of a folder that is not itself a symbolic link, or null. */
async function realDirectory(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isDirectory()) return null;
    return await realpath(path);
  } catch {
    return null;
  }
}

/** The agents' project folders, by real path when the folder exists. */
function realProjectFolders(agents: readonly StorageAgent[]): Promise<string[]> {
  return Promise.all(
    agents.flatMap((agent) =>
      (agent.projectFolders ?? []).map((folder) => realpath(folder.path).catch(() => resolve(folder.path))),
    ),
  );
}

/**
 * Paths the agent store derives from an agent id under each root. The store deletes them with the
 * agent, so they are the agent's even when its workspace path names another folder.
 */
function ownedWorkspacePaths(roots: readonly string[], agents: readonly StorageAgent[]): string[] {
  return roots.flatMap((root) =>
    agents.flatMap((agent) => [join(root, agent.id), join(root, legacyAgentId(agent.id))]),
  );
}

/**
 * Whether `path` is a folder the user may move to the Trash from Storage: an absolute path directly
 * in one of `roots`, not an unfinished copy, not an agent workspace, not inside one, and with no
 * agent workspace inside it. Pure, so the caller resolves links first.
 */
export function canTrashUnassignedFolder(
  path: string,
  roots: readonly string[],
  agentWorkspaces: readonly string[],
): boolean {
  if (!isAbsolute(path)) return false;
  const candidate = resolve(path);
  if (candidate !== path.replace(/[\\/]+$/u, "")) return false;
  if (!roots.some((root) => resolve(root) === dirname(candidate))) return false;
  if (basename(candidate).toLowerCase().endsWith(STAGE_SUFFIX)) return false;
  return !agentWorkspaces.some((workspace) => {
    const owned = resolve(workspace);
    return owned === candidate || isWithin(candidate, owned) || isWithin(owned, candidate);
  });
}

/**
 * The real path of a folder the user asked to move to the Trash, checked again here from the disk,
 * never from what the renderer saw: it must be a real folder (not a link) directly in a workspace
 * root, with no agent owning it or any folder inside it, and no file in it changed for
 * `UNASSIGNED_FOLDER_QUIET_MS` (walked with the scan's bound). Throws when any check fails.
 */
async function trashableUnassignedFolder(
  path: string,
  roots: readonly string[],
  agents: readonly StorageAgent[],
  now: number,
): Promise<string> {
  const refuse = () => new Error(sourceText("error.storage.folderNotTrashable"));
  // Only the exact path the scan listed: no `..`, `.` or doubled separators.
  if (!isAbsolute(path) || resolve(path) !== path.replace(/[\\/]+$/u, "")) throw refuse();
  const target = await realDirectory(path);
  if (!target) throw refuse();
  const realRoots = (await Promise.all(roots.map(realDirectory))).filter((root): root is string => root !== null);
  const workspaces = await Promise.all(
    agents.map((agent) => realpath(agent.workspacePath).catch(() => resolve(agent.workspacePath))),
  );
  workspaces.push(...ownedWorkspacePaths(realRoots, agents), ...(await realProjectFolders(agents)));
  if (!canTrashUnassignedFolder(target, realRoots, workspaces)) throw refuse();
  // The same folder by another spelling, such as other letter case on macOS: compare identities.
  const identity = await lstat(target);
  for (const workspace of workspaces) {
    for (let current = workspace; ; current = dirname(current)) {
      const info = await lstat(current).catch(() => null);
      if (info && info.dev === identity.dev && info.ino === identity.ino) throw refuse();
      if (dirname(current) === current) break;
    }
  }
  if (!quietFolder(await measureTree(target), now)) throw new Error(sourceText("error.storage.folderRecentlyChanged"));
  return target;
}

/** Two records can point at one file on disk; count it once. */
function uniqueBytes(files: readonly MeasuredFile[]): number {
  const byPath = new Map<string, number>();
  for (const file of files) byPath.set(file.stored.path, file.bytes);
  return [...byPath.values()].reduce((total, bytes) => total + bytes, 0);
}

/**
 * Removes what is in each cache folder, or the rotated log files, and nothing else: the folders
 * stay, and a subfolder of a log folder (such as the transfer journal) is not touched.
 */
async function clearStorageCategory(roots: StorageRoots, category: ClearableStorageCategory): Promise<void> {
  if (category === "logs") {
    for (const directory of roots.logs)
      await Promise.all((await logFiles(directory)).map((path) => rm(path, { force: true })));
    return;
  }
  for (const directory of roots.caches) {
    let children: Dirent[];
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    await Promise.all(children.map((child) => rm(join(directory, child.name), { recursive: true, force: true })));
  }
}

function scopeKey(input: GetStorageUsageInput): string {
  return JSON.stringify([input.scope, input.agentId ?? null, input.conversationId ?? null]);
}

/**
 * Scans are slow on a large host, so each scope keeps its last answer for a minute, and two
 * surfaces that ask at the same time share one scan. A delete, a clear, or a change to the agents
 * drops every answer, and a scan that was running at that moment is not kept.
 */
export class StorageUsageService {
  readonly #scanner: Pick<StorageUsageScanner, "measure">;
  readonly #sources: Pick<StorageUsageSources, "roots" | "mailbox" | "agents">;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; scan: StorageScan }>();
  readonly #running = new Map<string, Promise<StorageScan>>();
  #generation = 0;

  constructor(
    scanner: Pick<StorageUsageScanner, "measure">,
    sources: Pick<StorageUsageSources, "roots" | "mailbox" | "agents">,
    now: () => number = Date.now,
  ) {
    this.#scanner = scanner;
    this.#sources = sources;
    this.#now = now;
  }

  async usage(input: GetStorageUsageInput): Promise<StorageUsage> {
    return (await this.#scan(input)).usage;
  }

  /** Local only: the folders with no agent, from the same host scan as the Storage tab. */
  async unassignedFolders(): Promise<UnassignedFolder[]> {
    return (await this.#scan({ scope: "host" })).unassignedFolders;
  }

  /**
   * Moves one folder with no agent to the Trash with `moveToTrash`, so the user can put it back.
   * The path is checked again here against the disk and the current agents.
   */
  async trashUnassignedFolder(path: string, moveToTrash: (path: string) => Promise<void>): Promise<void> {
    const target = await trashableUnassignedFolder(
      path,
      this.#sources.roots.workspaceRoots,
      this.#sources.agents(),
      this.#now(),
    );
    try {
      await moveToTrash(target);
    } finally {
      this.invalidate();
    }
  }

  #scan(input: GetStorageUsageInput): Promise<StorageScan> {
    const key = scopeKey(input);
    const cached = this.#cache.get(key);
    if (!input.force && cached && this.#now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.scan);
    const running = this.#running.get(key);
    if (running) return running;
    const generation = this.#generation;
    const settled = this.#scanner
      .measure(input)
      .then((scan) => {
        if (generation === this.#generation) this.#cache.set(key, { at: this.#now(), scan });
        return scan;
      })
      .finally(() => {
        if (this.#running.get(key) === settled) this.#running.delete(key);
      });
    this.#running.set(key, settled);
    return settled;
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.#sources.mailbox.listStoredFiles().some((file) => file.attachment.id === fileId))
      throw new StorageNotFoundError(sourceText("error.backend.fileGone"));
    try {
      await this.#sources.mailbox.deleteStoredFile(fileId);
    } finally {
      this.invalidate();
    }
  }

  async clear(category: ClearableStorageCategory): Promise<void> {
    try {
      await clearStorageCategory(this.#sources.roots, category);
    } finally {
      this.invalidate();
    }
  }

  invalidate(): void {
    this.#generation += 1;
    this.#cache.clear();
    this.#running.clear();
  }
}
