import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type GoogleConnectorRecord, GoogleConnectorStore } from "./google-connector-store";
import { FAKE_GOOGLE_CIPHER } from "./google-test-server";

const RECORD: GoogleConnectorRecord = {
  accessToken: "ya29.storedaccesstokenvalue",
  accessTokenExpiresAt: 1_900_000_000_000,
  refreshToken: "1//storedrefreshtokenvalue",
  email: "owner@example.com",
  scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar.events"],
};

async function storePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "goahead-google-store-")), "google.json");
}

describe("GoogleConnectorStore", () => {
  it("keeps the tokens encrypted and readable only by the owner", async () => {
    const path = await storePath();
    const store = new GoogleConnectorStore(path, FAKE_GOOGLE_CIPHER);
    await store.load();
    await store.write(RECORD);

    const source = await readFile(path, "utf8");
    expect(source).not.toContain("storedaccesstokenvalue");
    expect(source).not.toContain("storedrefreshtokenvalue");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);

    const reopened = new GoogleConnectorStore(path, FAKE_GOOGLE_CIPHER);
    expect(await reopened.load()).toBeNull();
    expect(reopened.read()).toEqual(RECORD);
  });

  it("leaves a file it cannot decrypt on disk", async () => {
    const path = await storePath();
    await writeFile(path, JSON.stringify({ version: 1, record: "bm90IGEgcmVjb3Jk" }));
    const store = new GoogleConnectorStore(path, FAKE_GOOGLE_CIPHER);

    expect(await store.load()).toBeInstanceOf(Error);
    expect(store.read()).toBeNull();
    expect(await readFile(path, "utf8")).toContain("bm90IGEgcmVjb3Jk");
  });
});
