// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageUsage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenBotDatabase } from "./openbot-database";
import {
  canTrashUnassignedFolder,
  type StorageAgent,
  StorageUsageScanner,
  StorageUsageService,
  type StorageUsageSources,
} from "./storage-usage";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function file(path: string, bytes: number): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "x".repeat(bytes));
  return path;
}

/** A file that last changed 30 days ago: its folder is quiet enough to offer for the Trash. */
async function oldFile(path: string, bytes: number): Promise<string> {
  await file(path, bytes);
  const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  await utimes(path, old, old);
  return path;
}

async function host(extraAgents: StorageAgent[] = []) {
  const root = await mkdtemp(join(tmpdir(), "openbot-storage-unassigned-"));
  roots.push(root);
  const database = new OpenBotDatabase(join(root, "userData"));
  await Effect.runPromise(database.initialize());
  databases.push(database);
  await file(join(root, "outside", "large.bin"), 1_000);
  await file(join(root, "workspaces", "chief", "notes.md"), 11);
  await file(join(root, "workspaces", "writer", "draft.md"), 13);
  const agents: StorageAgent[] = [
    { id: "chief", workspacePath: join(root, "workspaces", "chief") },
    { id: "writer", workspacePath: join(root, "workspaces", "writer") },
    ...extraAgents,
  ];
  const sources: StorageUsageSources = {
    roots: {
      database: database.path,
      workspaceRoots: [join(root, "workspaces"), join(root, "legacy-workspaces")],
      downloads: join(root, "downloads"),
      caches: [],
      logs: [],
      runtimes: null,
      data: root,
    },
    database: () => database.connection,
    mailbox: { listStoredFiles: () => [], deleteStoredFile: () => Effect.void },
    agents: () => agents,
  };
  return { root, sources };
}

const bytesOf = (usage: StorageUsage) => Object.fromEntries(usage.breakdown.map((row) => [row.category, row.bytes]));
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const refusedWith = async (effect: Effect.Effect<unknown, unknown>, text: string) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(exit._tag).toBe("Failure");
  expect(JSON.stringify(exit, (_key, value) => (value instanceof Error ? value.message : value))).toContain(text);
};

describe("folders with no agent", () => {
  it("counts and lists a quiet folder no agent owns under the current and the legacy root", async () => {
    const { root, sources } = await host();
    await oldFile(join(root, "workspaces", "qa", "runtime.img"), 17);
    await oldFile(join(root, "legacy-workspaces", "old", "notes.md"), 19);
    // An unfinished copy is counted but never offered for the Trash.
    await file(join(root, "workspaces", "agent-copy.openbot-stage", "notes.md"), 3);
    await symlink(join(root, "outside"), join(root, "workspaces", "linked"));

    const scan = await run(new StorageUsageScanner(sources).measure({ scope: "host" }));

    expect(bytesOf(scan.usage).workspaces).toBe(11 + 13 + 17 + 19 + 3);
    expect(scan.unassignedFolders).toEqual([
      { path: join(root, "legacy-workspaces", "old"), bytes: 19 },
      { path: join(root, "workspaces", "qa"), bytes: 17 },
    ]);
    // The answer a joined server reads carries no path.
    expect(JSON.stringify(scan.usage)).not.toContain(root);
  });

  it("refuses project folders, folders that hold a workspace, links, other paths and recent folders", async () => {
    const { root, sources } = await host();
    await file(join(root, "workspaces", "project", "src.ts"), 4);
    await file(join(root, "workspaces", "team", "nested", "notes.md"), 2);
    await oldFile(join(root, "workspaces", "qa", "runtime.img"), 17);
    await file(join(root, "workspaces", "recent", "today.md"), 3);
    await symlink(join(root, "outside"), join(root, "workspaces", "linked"));
    const agents = sources.agents();
    const guarded: StorageUsageSources = {
      ...sources,
      agents: () => [
        ...agents.map((agent) =>
          agent.id === "chief" ? { ...agent, projectFolders: [{ path: join(root, "workspaces", "project") }] } : agent,
        ),
        { id: "nested", workspacePath: join(root, "workspaces", "team", "nested") },
      ],
    };
    const service = new StorageUsageService(new StorageUsageScanner(guarded), guarded);
    const moveToTrash = vi.fn(async (_path: string) => undefined);

    expect(await run(service.unassignedFolders())).toEqual([{ path: join(root, "workspaces", "qa"), bytes: 17 }]);
    for (const refused of [
      join(root, "workspaces", "project"),
      join(root, "workspaces", "team"),
      join(root, "workspaces", "chief"),
      join(root, "workspaces", "linked"),
      // Raw strings: `join` would normalize the `..` away before the check sees it.
      `${join(root, "workspaces", "team")}/../qa`,
      join(root, "outside"),
      join(root, "workspaces", "missing"),
    ])
      await refusedWith(
        service.trashUnassignedFolder(refused, moveToTrash),
        "This folder cannot be moved to the Trash.",
      );
    await refusedWith(
      service.trashUnassignedFolder(join(root, "workspaces", "recent"), moveToTrash),
      "A file in it changed in the last 7 days",
    );
    expect(moveToTrash).not.toHaveBeenCalled();

    await run(service.trashUnassignedFolder(join(root, "workspaces", "qa"), moveToTrash));
    expect(moveToTrash).toHaveBeenCalledExactlyOnceWith(await realpath(join(root, "workspaces", "qa")));
  });

  it("allows only an unowned direct child of a workspace root", () => {
    const workspaceRoots = ["/home/u/OpenBot/Agents", "/home/u/OpenBot/Bots"];
    const workspaces = ["/home/u/OpenBot/Agents/chief", "/home/u/OpenBot/Agents/team/nested"];
    const allowed = (path: string) => canTrashUnassignedFolder(path, workspaceRoots, workspaces);

    expect(allowed("/home/u/OpenBot/Agents/qa")).toBe(true);
    expect(allowed("/home/u/OpenBot/Bots/old")).toBe(true);
    expect(allowed("/home/u/Documents/qa")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents/qa/inner")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents/../Shared")).toBe(false);
    expect(allowed("OpenBot/Agents/qa")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents/chief")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents/team")).toBe(false);
    expect(allowed("/home/u/OpenBot/Agents/agent-copy.openbot-stage")).toBe(false);
  });
});
