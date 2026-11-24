// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAT_BACKDROP_UPLOAD_LIMITS, uploadBackdropChoice } from "@openbot/contracts/chat-backdrop";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_BACKDROP_CHOICE_FILE, CHAT_BACKDROP_UPLOAD_DIRECTORY, ChatBackdropStore } from "./chat-backdrop-store";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 0x42, 0xf2]);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-backdrop-"));
  roots.push(root);
  return root;
}

async function loadedStore(userData: string): Promise<ChatBackdropStore> {
  const store = new ChatBackdropStore(userData);
  await store.load();
  return store;
}

async function sourceFile(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(await temporaryRoot(), name);
  await writeFile(path, bytes);
  return path;
}

describe("ChatBackdropStore choice", () => {
  it("reads a profile from before backdrops as no backdrop, the look of today", async () => {
    const store = await loadedStore(await temporaryRoot());
    expect(store.state()).toEqual({ choice: null, uploads: [] });
  });

  it("reads a malformed, unknown-version or unknown-scene file as no backdrop", async () => {
    for (const content of ["{not json", '{"version":2,"choice":"pond"}', '{"version":1,"choice":"aquarium"}']) {
      const userData = await temporaryRoot();
      await writeFile(join(userData, CHAT_BACKDROP_CHOICE_FILE), content);
      expect((await loadedStore(userData)).state().choice).toBeNull();
    }
  });

  it("starts with no backdrop when a file cannot be read, so the app still starts", async () => {
    const userData = await temporaryRoot();
    // A directory where each file should be: reading it fails with EISDIR, not ENOENT.
    await mkdir(join(userData, CHAT_BACKDROP_CHOICE_FILE));
    await mkdir(join(userData, CHAT_BACKDROP_UPLOAD_DIRECTORY, "backdrops-v1.json"), { recursive: true });
    expect((await loadedStore(userData)).state()).toEqual({ choice: null, uploads: [] });
  });

  it("keeps a scene across a restart in a versioned file", async () => {
    const userData = await temporaryRoot();
    await (await loadedStore(userData)).setChoice("fireflies");
    expect(JSON.parse(await readFile(join(userData, CHAT_BACKDROP_CHOICE_FILE), "utf8"))).toEqual({
      version: 1,
      choice: "fireflies",
    });
    expect((await loadedStore(userData)).state().choice).toBe("fireflies");
  });

  it("refuses an upload id that it does not hold", async () => {
    const store = await loadedStore(await temporaryRoot());
    await expect(store.setChoice(uploadBackdropChoice("00000000-0000-4000-8000-000000000000"))).rejects.toThrow(
      "Unknown backdrop upload.",
    );
    expect(store.state().choice).toBeNull();
  });
});

describe("ChatBackdropStore uploads", () => {
  it("keeps an image across a restart, shows it, and serves only its own file", async () => {
    const userData = await temporaryRoot();
    const store = await loadedStore(userData);
    const result = await store.importFile(await sourceFile("Beach day.PNG", PNG));
    if (result.status !== "added") throw new Error(`expected added, got ${result.status}`);
    const [upload] = result.state.uploads;
    expect(upload).toMatchObject({ name: "Beach day", kind: "image" });
    if (!upload) throw new Error("no upload");
    expect(result.state.choice).toBe(uploadBackdropChoice(upload.id));

    const reloaded = await loadedStore(userData);
    expect(reloaded.state()).toEqual(result.state);
    const served = reloaded.resolveUpload(upload.id);
    expect(served?.mimeType).toBe("image/png");
    expect(new Uint8Array(await readFile(served?.path ?? ""))).toEqual(PNG);
    expect(reloaded.resolveUpload("../openbot.db")).toBeNull();
  });

  it("accepts a video by its signature", async () => {
    const store = await loadedStore(await temporaryRoot());
    const result = await store.importFile(await sourceFile("waves.webm", WEBM));
    expect(result.status === "added" && result.state.uploads[0]?.kind).toBe("video");
  });

  it("refuses a type outside the allowlist and a file whose bytes are not its extension", async () => {
    const userData = await temporaryRoot();
    const store = await loadedStore(userData);
    await expect(store.importFile(await sourceFile("page.html", PNG))).resolves.toEqual({
      status: "refused",
      reason: "type",
    });
    await expect(
      store.importFile(await sourceFile("fake.png", new TextEncoder().encode("<svg></svg>"))),
    ).resolves.toEqual({ status: "refused", reason: "type" });
    await expect(store.importFile(await sourceFile("fake.mp4", PNG))).resolves.toEqual({
      status: "refused",
      reason: "type",
    });
    expect(store.state()).toEqual({ choice: null, uploads: [] });
    await expect(readdir(join(userData, CHAT_BACKDROP_UPLOAD_DIRECTORY))).rejects.toThrow();
  });

  it("refuses an image or a video over its size limit before it copies a byte", async () => {
    const userData = await temporaryRoot();
    const store = await loadedStore(userData);
    const image = await sourceFile("huge.png", PNG);
    await truncate(image, CHAT_BACKDROP_UPLOAD_LIMITS.image + 1);
    const video = await sourceFile("huge.webm", WEBM);
    await truncate(video, CHAT_BACKDROP_UPLOAD_LIMITS.video + 1);
    await expect(store.importFile(image)).resolves.toEqual({ status: "refused", reason: "size" });
    await expect(store.importFile(video)).resolves.toEqual({ status: "refused", reason: "size" });
    expect(store.state().uploads).toEqual([]);
    await expect(readdir(join(userData, CHAT_BACKDROP_UPLOAD_DIRECTORY))).rejects.toThrow();
  });

  it("removes the file and clears the choice when the shown upload is removed", async () => {
    const userData = await temporaryRoot();
    const store = await loadedStore(userData);
    const result = await store.importFile(await sourceFile("a.png", PNG));
    const id = result.status === "added" ? result.state.uploads[0]?.id : undefined;
    if (!id) throw new Error("no upload");
    const path = store.resolveUpload(id)?.path ?? "";
    await expect(store.remove(id)).resolves.toEqual({ choice: null, uploads: [] });
    await expect(readFile(path)).rejects.toThrow();
    expect((await loadedStore(userData)).state()).toEqual({ choice: null, uploads: [] });
  });

  it("keeps at most the limit, and removes the oldest file first", async () => {
    const store = await loadedStore(await temporaryRoot());
    const ids: string[] = [];
    for (let index = 0; index <= CHAT_BACKDROP_UPLOAD_LIMITS.count; index += 1) {
      const result = await store.importFile(await sourceFile(`${index}.png`, PNG));
      if (result.status === "added") ids.push(result.state.uploads.at(-1)?.id ?? "");
    }
    const kept = store.state().uploads.map(({ id }) => id);
    expect(kept).toEqual(ids.slice(1));
    expect(store.resolveUpload(ids[0] ?? "")).toBeNull();
  });
});
