// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadBackdropChoice } from "@openbot/contracts/chat-backdrop";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_BACKDROP_CHOICE_FILE, CHAT_BACKDROP_UPLOAD_DIRECTORY, ChatBackdropStore } from "./chat-backdrop-store";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

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

describe("ChatBackdropStore uploads of GoAhead v0.40 and v0.41", () => {
  const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

  // The files that v0.40 wrote: `<id>.<extension>` and the index in `chat-backdrops/`, and the choice.
  async function v040Profile(): Promise<string> {
    const userData = await temporaryRoot();
    const directory = join(userData, CHAT_BACKDROP_UPLOAD_DIRECTORY);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${ID}.png`), PNG);
    await writeFile(
      join(directory, "backdrops-v1.json"),
      JSON.stringify({
        version: 1,
        backdrops: [{ id: ID, name: "Beach day", kind: "image", createdAt: 1_760_000_000_000, extension: "png" }],
      }),
    );
    await writeFile(
      join(userData, CHAT_BACKDROP_CHOICE_FILE),
      JSON.stringify({ version: 1, choice: uploadBackdropChoice(ID) }),
    );
    return userData;
  }

  it("reads an upload, shows it, and serves only its own file", async () => {
    const store = await loadedStore(await v040Profile());
    expect(store.state()).toEqual({
      choice: uploadBackdropChoice(ID),
      uploads: [{ id: ID, name: "Beach day", kind: "image", createdAt: 1_760_000_000_000 }],
    });
    const served = store.resolveUpload(ID);
    expect(served?.mimeType).toBe("image/png");
    expect(new Uint8Array(await readFile(served?.path ?? ""))).toEqual(PNG);
    expect(store.resolveUpload("../openbot.db")).toBeNull();
  });

  it("removes only the chosen file and clears the choice, and keeps the folder", async () => {
    const userData = await v040Profile();
    const store = await loadedStore(userData);
    const path = store.resolveUpload(ID)?.path ?? "";
    await expect(store.remove(ID)).resolves.toEqual({ choice: null, uploads: [] });
    await expect(readFile(path)).rejects.toThrow();
    await expect(readdir(join(userData, CHAT_BACKDROP_UPLOAD_DIRECTORY))).resolves.toEqual(["backdrops-v1.json"]);
    expect((await loadedStore(userData)).state()).toEqual({ choice: null, uploads: [] });
  });
});
