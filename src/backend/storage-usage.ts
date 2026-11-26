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
  type StorageDisk,
  type StorageUsage,
  type StoredFileRow,
  UNASSIGNED_FOLDER_LIMIT,
  type UnassignedFolder,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Result, Scope, Semaphore } from "effect";
import {
  type StoragePlacement,
  type StorageThread,
  storagePlacementPage,
  storageThreadSize,
  storageThreads,
} from "./database/storage-usage-queries";
import type { MailboxStore, MailboxStoredFile } from "./mailbox-store";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";
import type { UserFilesBytes } from "./user-files-bytes";
import type { WorkflowFileOwner } from "./workflows/workflow-file-owners";
import { isWithin } from "./workspace-paths";

interface StorageRoots {
  database: string;
  /**
   * The current and the legacy parent folders of managed agent workspaces. A folder with no agent in
   * them counts as workspaces and can go to the Trash. Absent: no such folder is looked for.
   */
  workspaceRoots?: readonly string[];
  downloads: string;
  caches: readonly string[];
  logs: readonly string[];
  runtimes: string | null;
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
  mailbox: {
    listStoredFiles: MailboxStore["listStoredFiles"];
    deleteStoredFile: OmitThisParameter<MailboxStore["deleteStoredFile"]>;
  };
  agents: () => readonly StorageAgent[];
  channelFiles?: (channelId: string) => readonly StorageChannelFile[] | null;
  userFiles?: Pick<UserFilesBytes, "read" | "forget" | "dispose">;
  workflowFiles?: () => ReadonlyMap<string, WorkflowFileOwner>;
}

export interface StorageChannelFile {
  attachmentId: string;
  messageId: string;
}

/** One host scan: the answer every surface reads, and the local-only folders with no agent. */
export interface StorageScan {
  usage: StorageUsage;
  /** Largest first. Empty for an agent, a chat or a channel scope. */
  unassignedFolders: UnassignedFolder[];
}

export class StorageNotFoundError extends Error {}

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

const yieldToEventLoop = Effect.callback<void>((resume) => {
  const pending = setImmediate(() => resume(Effect.void));
  return Effect.sync(() => clearImmediate(pending));
});

interface TreeSize {
  bytes: number;
  complete: boolean;
  /** The newest modification time of a regular file under the root, in epoch milliseconds; 0 with no file. */
  newestModifiedMs: number;
}

/**
 * Bytes of the regular files under `root`, and the newest of their modification times. A symbolic
 * link is never followed. A folder in `skip` (real paths) is not entered: it is counted with its agent.
 */
export const measureTree = Effect.fn("StorageUsage.measureTree")(function* (
  root: string,
  entryLimit = STORAGE_WALK_ENTRY_LIMIT,
  skip?: ReadonlySet<string>,
): Effect.fn.Return<TreeSize, StoredStateFailure> {
  const resolved = yield* Effect.result(
    Effect.gen(function* () {
      const path = yield* storedIO(() => realpath(root));
      const stats = yield* storedIO(() => lstat(path));
      return stats.isDirectory() ? path : null;
    }),
  );
  if (Result.isFailure(resolved) || resolved.success === null) return { bytes: 0, complete: true, newestModifiedMs: 0 };
  const start = resolved.success;
  const pending = [start];
  let bytes = 0;
  let newestModifiedMs = 0;
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop() ?? start;
    const children = yield* Effect.result(storedIO(() => readdir(directory, { withFileTypes: true })));
    if (Result.isFailure(children)) continue;
    const files: string[] = [];
    for (const child of children.success) {
      if (++entries > entryLimit) return { bytes, complete: false, newestModifiedMs };
      const path = join(directory, child.name);
      if (child.isDirectory()) {
        if (!skip?.has(path)) pending.push(path);
      } else if (child.isFile()) files.push(path);
    }
    for (let index = 0; index < files.length; index += STAT_BATCH)
      for (const info of yield* Effect.forEach(files.slice(index, index + STAT_BATCH), fileInfo, {
        concurrency: STAT_BATCH,
      })) {
        bytes += info.size;
        newestModifiedMs = Math.max(newestModifiedMs, info.modifiedMs);
      }
  }
  return { bytes, complete: true, newestModifiedMs };
});

const fileInfo = Effect.fn("StorageUsage.fileInfo")((path: string) =>
  storedIO(() => lstat(path)).pipe(
    Effect.map((info) => (info.isFile() ? { size: info.size, modifiedMs: info.mtimeMs } : { size: 0, modifiedMs: 0 })),
    Effect.catch(() => Effect.succeed({ size: 0, modifiedMs: 0 })),
  ),
);

const fileSize = Effect.fn("StorageUsage.fileSize")((path: string) =>
  storedIO(() => lstat(path)).pipe(
    Effect.map((info) => (info.isFile() ? info.size : 0)),
    Effect.catch(() => Effect.succeed(0)),
  ),
);
const logFiles = Effect.fn("StorageUsage.logFiles")((directory: string) =>
  storedIO(() => readdir(directory, { withFileTypes: true })).pipe(
    Effect.map((children) =>
      children
        .filter((child) => child.isFile() && LOG_FILE.test(child.name))
        .map((child) => join(directory, child.name)),
    ),
    Effect.catch(() => Effect.succeed([])),
  ),
);

function safeBytes(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export const diskSpace = Effect.fn("StorageUsage.diskSpace")((path: string) =>
  storedIO(() => statfs(path)).pipe(
    Effect.map(
      (filesystem): StorageDisk => ({
        freeBytes: safeBytes(filesystem.bavail * filesystem.bsize),
        totalBytes: safeBytes(filesystem.blocks * filesystem.bsize),
      }),
    ),
    Effect.catch(() => Effect.succeed<StorageDisk>({ freeBytes: null, totalBytes: null })),
  ),
);

const freeBytes = (path: string) => diskSpace(path).pipe(Effect.map((disk) => disk.freeBytes));

function wireId(value: string | null | undefined): string | null {
  return value && value.length <= INPUT_LIMITS.identifier ? value : null;
}

interface MeasuredFile {
  stored: MailboxStoredFile;
  placement: StoragePlacement | null;
  threadIds: ReadonlySet<string>;
  channelMessageId: string | null;
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

  scan = (input: GetStorageUsageInput): Effect.Effect<StorageUsage, StoredStateFailure> =>
    this.measure(input).pipe(Effect.map((scan) => scan.usage));

  measure = Effect.fn("StorageUsage.measure")(function* (
    this: StorageUsageScanner,
    input: GetStorageUsageInput,
  ): Effect.fn.Return<StorageScan, StoredStateFailure> {
    const scannedAt = new Date().toISOString();
    const agents = this.#sources.agents();
    const scopeAgent = input.agentId === undefined ? null : agents.find((agent) => agent.id === input.agentId);
    if (input.scope === "agent" && !scopeAgent)
      return yield* new StoredStateFailure({
        cause: new StorageNotFoundError(sourceText("error.storage.agentMissing")),
      });

    const channelFiles =
      input.scope === "channel" && input.channelId !== undefined
        ? (this.#sources.channelFiles?.(input.channelId) ?? null)
        : undefined;
    if (channelFiles === null)
      return yield* new StoredStateFailure({
        cause: new StorageNotFoundError(sourceText("error.backend.channelNotFound")),
      });

    const db = this.#sources.database();
    let threads = channelFiles ? [] : yield* storedSync(() => storageThreads(db, input.agentId));
    if (input.scope === "conversation") threads = threads.filter((thread) => thread.threadId === input.conversationId);
    const threadById = new Map(threads.map((thread) => [thread.threadId, thread]));
    const placements = yield* this.#placements(db, threadById);
    const files = yield* this.#measureFiles(input, placements, threadById, channelFiles);
    const threadSizes = new Map<string, { messageCount: number; bytes: number }>();
    for (const thread of threads) {
      threadSizes.set(thread.threadId, yield* storedSync(() => storageThreadSize(db, thread.threadId)));
      yield* yieldToEventLoop;
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
    const workflowFiles =
      input.scope === "host" && this.#sources.workflowFiles
        ? yield* storedSync(this.#sources.workflowFiles)
        : new Map<string, WorkflowFileOwner>();
    const fileRows = largestFirst(
      files.map((file) => ({ bytes: file.bytes, row: this.#fileRow(file, threadById, workflowFiles, scannedAt) })),
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
      const measured = yield* this.#hostFolders(agents);
      truncated ||= !measured.complete;
      breakdown = [
        breakdownRow("workspaces", measured.workspaces),
        breakdownRow("attachments", sum("attachment")),
        breakdownRow("generated", sum("generated")),
        breakdownRow("chats", yield* this.#databaseBytes()),
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
      const workspace = yield* measureTree(scopeAgent.workspacePath);
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
      ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
      scannedAt,
      freeBytes: yield* freeBytes(this.#sources.roots.data),
      breakdown,
      agents: agentRows,
      conversations: conversations.rows,
      files: fileRows.rows.map((entry) => entry.row),
      truncated,
    };
    return { usage, unassignedFolders };
  }).bind(this);

  #placements = Effect.fn("StorageUsage.placements")(function* (
    this: StorageUsageScanner,
    db: DatabaseSync,
    threadById: ReadonlyMap<string, StorageThread>,
  ): Effect.fn.Return<Map<string, StoragePlacement[]>, StoredStateFailure> {
    const byAttachment = new Map<string, StoragePlacement[]>();
    if (threadById.size === 0) return byAttachment;
    let afterId: string | null = "";
    while (afterId !== null) {
      const cursor: string = afterId;
      const page: ReturnType<typeof storagePlacementPage> = yield* storedSync(() => storagePlacementPage(db, cursor));
      for (const placement of page.placements) {
        if (!threadById.has(placement.threadId)) continue;
        const list = byAttachment.get(placement.attachmentId);
        if (list) list.push(placement);
        else byAttachment.set(placement.attachmentId, [placement]);
      }
      afterId = page.nextId;
      yield* yieldToEventLoop;
    }
    return byAttachment;
  });

  #measureFiles = Effect.fn("StorageUsage.measureFiles")(function* (
    this: StorageUsageScanner,
    input: GetStorageUsageInput,
    placements: ReadonlyMap<string, StoragePlacement[]>,
    threadById: ReadonlyMap<string, StorageThread>,
    channelFiles: readonly StorageChannelFile[] | undefined,
  ): Effect.fn.Return<MeasuredFile[], StoredStateFailure> {
    const channelMessage = new Map(channelFiles?.map((entry) => [entry.attachmentId, entry.messageId]));
    const seen = new Set<string>();
    const selected: Omit<MeasuredFile, "bytes" | "status" | "modifiedAt">[] = [];
    for (const stored of this.#sources.mailbox.listStoredFiles()) {
      if (seen.has(stored.attachment.id)) continue;
      const shown = [...(placements.get(stored.attachment.id) ?? [])].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const inScope =
        input.scope === "host" ||
        shown.length > 0 ||
        (input.scope === "agent" && stored.agentId === input.agentId) ||
        channelMessage.has(stored.attachment.id);
      if (!inScope) continue;
      seen.add(stored.attachment.id);
      const placement = shown[0] ?? null;
      const placementAgent = placement ? (threadById.get(placement.threadId)?.agentId ?? null) : null;
      selected.push({
        stored,
        placement,
        threadIds: new Set(shown.map((entry) => entry.threadId)),
        channelMessageId: channelMessage.get(stored.attachment.id) ?? null,
        agentId: input.scope === "agent" ? (input.agentId ?? null) : (placementAgent ?? stored.agentId),
      });
    }
    const measured: MeasuredFile[] = [];
    for (let index = 0; index < selected.length; index += STAT_BATCH) {
      const batch = selected.slice(index, index + STAT_BATCH);
      const infos = yield* Effect.forEach(
        batch,
        (file) => storedIO(() => lstat(file.stored.path)).pipe(Effect.catch(() => Effect.succeed(null))),
        { concurrency: STAT_BATCH },
      );
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
  });

  #fileRow(
    file: MeasuredFile,
    threadById: ReadonlyMap<string, StorageThread>,
    workflowFiles: ReadonlyMap<string, WorkflowFileOwner>,
    scannedAt: string,
  ): StoredFileRow {
    const thread = file.placement ? threadById.get(file.placement.threadId) : undefined;
    const conversationId = wireId(thread?.threadId);
    const messageId = conversationId ? wireId(file.placement?.messageId) : wireId(file.channelMessageId);
    const owner = file.stored.source === "generated" ? workflowFiles.get(file.stored.attachment.id) : undefined;
    return {
      ...file.stored.attachment,
      source: file.stored.source,
      agentId: wireId(file.agentId),
      conversation:
        thread && conversationId ? { id: conversationId, title: thread.title.slice(0, STORAGE_LIMITS.title) } : null,
      messageId,
      createdAt: file.stored.createdAt ?? file.placement?.createdAt ?? owner?.createdAt ?? file.modifiedAt ?? scannedAt,
      status: file.status,
      deletable: true,
      ...(owner ? { workflow: owner.workflow } : {}),
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

  #databaseBytes = Effect.fn("StorageUsage.databaseBytes")(function* (
    this: StorageUsageScanner,
  ): Effect.fn.Return<number, StoredStateFailure> {
    const path = this.#sources.roots.database;
    const sizes = yield* Effect.forEach([path, `${path}-wal`, `${path}-shm`], fileSize, { concurrency: "unbounded" });
    return sizes.reduce((total, size) => total + size, 0);
  });

  #hostFolders = Effect.fn("StorageUsage.hostFolders")(function* (
    this: StorageUsageScanner,
    agents: readonly StorageAgent[],
  ) {
    const roots = this.#sources.roots;
    let complete = true;
    const measureSize = (path: string, skip?: ReadonlySet<string>) =>
      Effect.gen(function* () {
        const size = yield* measureTree(path, STORAGE_WALK_ENTRY_LIMIT, skip);
        complete &&= size.complete;
        return size;
      });
    const measure = (path: string) => measureSize(path).pipe(Effect.map((size) => size.bytes));
    // Two agents can share a workspace folder, by one path or by two; the disk holds it once.
    const byWorkspace = new Map<string, number>();
    const byRealPath = new Map<string, number>();
    for (const path of new Set(agents.map((agent) => agent.workspacePath))) {
      const real = yield* realPath(path);
      if (!real) {
        byWorkspace.set(path, 0);
        continue;
      }
      const bytes = byRealPath.get(real) ?? (yield* measure(real));
      byRealPath.set(real, bytes);
      byWorkspace.set(path, bytes);
    }
    const registered = new Set(byRealPath.keys());
    const inUse = [...registered, ...(yield* realProjectFolders(agents))];
    const unassigned = yield* this.#unassignedFolders(agents, registered, inUse, measureSize);
    let caches = 0;
    for (const path of roots.caches) caches += yield* measure(path);
    let logs = 0;
    for (const directory of roots.logs)
      for (const size of yield* Effect.forEach(yield* logFiles(directory), fileSize, { concurrency: "unbounded" }))
        logs += size;
    return {
      byWorkspace,
      workspaces: [...byRealPath.values()].reduce((total, bytes) => total + bytes, 0) + unassigned.bytes,
      unassignedFolders: unassigned.folders,
      downloads: yield* measure(roots.downloads),
      caches,
      runtimes: roots.runtimes ? yield* measure(roots.runtimes) : 0,
      logs,
      complete,
    };
  });

  /**
   * What sits under a managed workspace root and is not a registered workspace: a folder an agent
   * made beside its own, a copy left by an import, a QA run. Its bytes count as workspaces. A folder
   * is offered for the Trash only when no agent of this profile owns it, no agent workspace is inside
   * it, and no file in it changed for `UNASSIGNED_FOLDER_QUIET_MS`: another profile or install can
   * share the root. A folder too large to walk to the end is not offered.
   */
  #unassignedFolders = Effect.fn("StorageUsage.unassignedFolders")(function* (
    this: StorageUsageScanner,
    agents: readonly StorageAgent[],
    registered: ReadonlySet<string>,
    inUse: readonly string[],
    measure: (path: string, skip?: ReadonlySet<string>) => Effect.Effect<TreeSize, StoredStateFailure>,
  ) {
    let bytes = 0;
    const folders: UnassignedFolder[] = [];
    for (const root of new Set(this.#sources.roots.workspaceRoots ?? [])) {
      const real = yield* realDirectory(root);
      // A root inside a registered workspace is already counted with that agent.
      if (!real || [...registered].some((workspace) => workspace === real || isWithin(workspace, real))) continue;
      const children = yield* Effect.result(storedIO(() => readdir(real, { withFileTypes: true })));
      if (Result.isFailure(children)) continue;
      const owned = new Set(ownedWorkspacePaths([real], agents));
      for (const child of children.success) {
        const path = join(real, child.name);
        if (child.isFile()) bytes += yield* fileSize(path);
        if (!child.isDirectory() || registered.has(path)) continue;
        const inside = new Set([...registered].filter((workspace) => isWithin(path, workspace)));
        const size = yield* measure(path, inside);
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
  });
}

/** A folder walked to the end in which no file changed for `UNASSIGNED_FOLDER_QUIET_MS`. */
function quietFolder(size: TreeSize, now: number): boolean {
  return size.complete && now - size.newestModifiedMs >= UNASSIGNED_FOLDER_QUIET_MS;
}

/** The real path, or null when it cannot be read. */
const realPath = (path: string) =>
  storedIO(() => realpath(path)).pipe(Effect.catch(() => Effect.succeed<string | null>(null)));

/** The real path of a folder that is not itself a symbolic link, or null. */
const realDirectory = (path: string) =>
  storedIO(async () => ((await lstat(path)).isDirectory() ? await realpath(path) : null)).pipe(
    Effect.catch(() => Effect.succeed<string | null>(null)),
  );

/** The agents' project folders, by real path when the folder exists. */
const realProjectFolders = (agents: readonly StorageAgent[]) =>
  Effect.forEach(
    agents.flatMap((agent) => agent.projectFolders ?? []),
    (folder) => realPath(folder.path).pipe(Effect.map((real) => real ?? resolve(folder.path))),
  );

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

class FolderNotTrashableError extends Error {}

/**
 * The real path of a folder the user asked to move to the Trash, checked again here from the disk,
 * never from what the renderer saw: it must be a real folder (not a link) directly in a workspace
 * root, with no agent owning it or any folder inside it, and no file in it changed for
 * `UNASSIGNED_FOLDER_QUIET_MS` (walked with the scan's bound). Fails when any check fails.
 */
const trashableUnassignedFolder = Effect.fn("StorageUsage.trashableUnassignedFolder")(function* (
  path: string,
  roots: readonly string[],
  agents: readonly StorageAgent[],
  now: number,
) {
  const refuse = () =>
    new StoredStateFailure({ cause: new FolderNotTrashableError(sourceText("error.storage.folderNotTrashable")) });
  // Only the exact path the scan listed: no `..`, `.` or doubled separators.
  if (!isAbsolute(path) || resolve(path) !== path.replace(/[\\/]+$/u, "")) return yield* refuse();
  const target = yield* realDirectory(path);
  if (!target) return yield* refuse();
  const realRoots = (yield* Effect.forEach(roots, realDirectory)).filter((root): root is string => root !== null);
  const workspaces = yield* Effect.forEach(agents, (agent) =>
    realPath(agent.workspacePath).pipe(Effect.map((real) => real ?? resolve(agent.workspacePath))),
  );
  workspaces.push(...ownedWorkspacePaths(realRoots, agents), ...(yield* realProjectFolders(agents)));
  if (!canTrashUnassignedFolder(target, realRoots, workspaces)) return yield* refuse();
  // The same folder by another spelling, such as other letter case on macOS: compare identities.
  const identity = yield* storedIO(() => lstat(target));
  for (const workspace of workspaces) {
    for (let current = workspace; ; current = dirname(current)) {
      const info = yield* storedIO(() => lstat(current)).pipe(Effect.catch(() => Effect.succeed(null)));
      if (info && info.dev === identity.dev && info.ino === identity.ino) return yield* refuse();
      if (dirname(current) === current) break;
    }
  }
  if (!quietFolder(yield* measureTree(target), now))
    return yield* new StoredStateFailure({
      cause: new FolderNotTrashableError(sourceText("error.storage.folderRecentlyChanged")),
    });
  return target;
});

function uniqueBytes(files: readonly MeasuredFile[]): number {
  const byPath = new Map<string, number>();
  for (const file of files) byPath.set(file.stored.path, file.bytes);
  return [...byPath.values()].reduce((total, bytes) => total + bytes, 0);
}

const clearStorageCategory = Effect.fn("StorageUsage.clearCategory")(function* (
  roots: StorageRoots,
  category: ClearableStorageCategory,
) {
  if (category === "logs") {
    for (const directory of roots.logs)
      yield* Effect.forEach(yield* logFiles(directory), (path) => storedIO(() => rm(path, { force: true })), {
        concurrency: "unbounded",
        discard: true,
      });
    return;
  }
  for (const directory of roots.caches) {
    const children = yield* Effect.result(storedIO(() => readdir(directory, { withFileTypes: true })));
    if (Result.isFailure(children)) continue;
    yield* Effect.forEach(
      children.success,
      (child) => storedIO(() => rm(join(directory, child.name), { recursive: true, force: true })),
      { concurrency: "unbounded", discard: true },
    );
  }
});

function scopeKey(input: GetStorageUsageInput): string {
  return JSON.stringify([input.scope, input.agentId ?? null, input.conversationId ?? null, input.channelId ?? null]);
}

export class StorageUsageService {
  readonly #scanner: { measure: OmitThisParameter<StorageUsageScanner["measure"]> };
  readonly #sources: Pick<StorageUsageSources, "roots" | "mailbox" | "userFiles"> &
    Partial<Pick<StorageUsageSources, "agents">>;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; scan: StorageScan }>();
  readonly #running = new Map<string, { token: symbol; fiber: Fiber.Fiber<StorageScan, StoredStateFailure> }>();
  readonly #scope = Scope.makeUnsafe();
  readonly #scanGate = Semaphore.makeUnsafe(1);
  #generation = 0;

  constructor(
    scanner: { measure: OmitThisParameter<StorageUsageScanner["measure"]> },
    sources: Pick<StorageUsageSources, "roots" | "mailbox" | "userFiles"> &
      Partial<Pick<StorageUsageSources, "agents">>,
    now: () => number = Date.now,
  ) {
    this.#scanner = scanner;
    this.#sources = sources;
    this.#now = now;
  }

  readonly usage = (input: GetStorageUsageInput): Effect.Effect<StorageUsage, StoredStateFailure> =>
    this.#scan(input).pipe(Effect.map((scan) => scan.usage));

  /** Local only: the folders with no agent, from the same host scan as the Storage tab. */
  readonly unassignedFolders = (): Effect.Effect<UnassignedFolder[], StoredStateFailure> =>
    this.#scan({ scope: "host" }).pipe(Effect.map((scan) => scan.unassignedFolders));

  /**
   * Moves one folder with no agent to the Trash with `moveToTrash`, so the user can put it back.
   * The path is checked again here against the disk and the current agents.
   */
  readonly trashUnassignedFolder = Effect.fn("StorageUsage.trashUnassignedFolder")(function* (
    this: StorageUsageService,
    path: string,
    moveToTrash: (path: string) => Promise<void>,
  ) {
    const target = yield* trashableUnassignedFolder(
      path,
      this.#sources.roots.workspaceRoots ?? [],
      this.#sources.agents?.() ?? [],
      this.#now(),
    );
    yield* storedIO(() => moveToTrash(target)).pipe(Effect.ensuring(Effect.sync(() => this.invalidate())));
  }).bind(this);

  readonly #scan = Effect.fn("StorageUsage.scan")(function* (this: StorageUsageService, input: GetStorageUsageInput) {
    const work = yield* this.#scanGate.withPermit(
      Effect.gen({ self: this }, function* () {
        const key = scopeKey(input);
        const cached = this.#cache.get(key);
        if (!input.force && cached && this.#now() - cached.at < CACHE_TTL_MS) return Effect.succeed(cached.scan);
        const running = this.#running.get(key);
        if (running) return Fiber.join(running.fiber);
        const generation = this.#generation;
        const token = Symbol();
        const fiber = yield* this.#scanner.measure(input).pipe(
          Effect.tap((scan) =>
            Effect.sync(() => {
              if (generation === this.#generation) this.#cache.set(key, { at: this.#now(), scan });
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (this.#running.get(key)?.token === token) this.#running.delete(key);
            }),
          ),
          Effect.forkIn(this.#scope),
        );
        this.#running.set(key, { token, fiber });
        return Fiber.join(fiber);
      }),
    );
    return yield* work;
  }).bind(this);

  readonly deleteFile = Effect.fn("StorageUsage.deleteFile")(function* (this: StorageUsageService, fileId: string) {
    if (!this.#sources.mailbox.listStoredFiles().some((file) => file.attachment.id === fileId))
      return yield* new StoredStateFailure({ cause: new StorageNotFoundError(sourceText("error.backend.fileGone")) });
    yield* this.#sources.mailbox.deleteStoredFile(fileId).pipe(Effect.ensuring(Effect.sync(() => this.#afterRemove())));
  }).bind(this);

  disk() {
    return diskSpace(this.#sources.roots.data);
  }

  readonly diskUse = Effect.fn("StorageUsage.diskUse")(function* (this: StorageUsageService) {
    const disk = yield* diskSpace(this.#sources.roots.data);
    const userBytes = this.#sources.userFiles ? yield* this.#sources.userFiles.read() : null;
    return { ...disk, userBytes };
  }).bind(this);

  clear(category: ClearableStorageCategory) {
    return clearStorageCategory(this.#sources.roots, category).pipe(
      Effect.ensuring(Effect.sync(() => this.#afterRemove())),
    );
  }

  dispose() {
    return Scope.close(this.#scope, Exit.void).pipe(
      Effect.andThen(this.#sources.userFiles ? this.#sources.userFiles.dispose() : Effect.void),
    );
  }

  #afterRemove(): void {
    this.invalidate();
    this.#sources.userFiles?.forget();
  }

  invalidate(): void {
    this.#generation += 1;
    this.#cache.clear();
    this.#running.clear();
  }
}
