import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INBOX_FILE_MAX_BYTES, MessagingInboxFiles } from "./messaging-inbox-files";
import type { InboxFile } from "./messaging-types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function file(id: string, overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    size: 1024,
    url: `https://files.slack.com/files-pri/T1-${id}/download/${id}.png`,
    thumbnailUrl: null,
    permalink: `https://acme.slack.com/files/U1/${id}`,
    ...overrides,
  };
}

describe("MessagingInboxFiles", () => {
  it("downloads a kept Slack image once, and refuses other addresses, other types and oversized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-inbox-files-"));
    roots.push(root);
    const files = new MessagingInboxFiles(root);
    await files.remember("conn-1", "D1", "1.000", new Date().toISOString(), [
      file("F1GOOD"),
      file("F2FOREIGN", { url: "https://evil.example.com/F2FOREIGN.png" }),
      file("F3BIG", { size: INBOX_FILE_MAX_BYTES + 1 }),
      file("F4PDF", { mimeType: "application/pdf" }),
    ]);
    const download = vi.fn(async (_url: string, destination: string) => writeFile(destination, "png"));

    const image = await files.image("conn-1", "F1GOOD", download);
    expect(image?.mimeType).toBe("image/png");
    expect(await readFile(image?.path ?? "", "utf8")).toBe("png");
    await files.image("conn-1", "F1GOOD", download);
    expect(download).toHaveBeenCalledOnce();

    expect(await files.image("conn-1", "F2FOREIGN", download)).toBeNull();
    expect(await files.image("conn-1", "F3BIG", download)).toBeNull();
    expect(await files.image("conn-1", "F4PDF", download)).toBeNull();
    expect(await files.image("conn-1", "F9UNKNOWN", download)).toBeNull();
    expect(await files.image("conn-1", "../../etc", download)).toBeNull();
    expect(download).toHaveBeenCalledOnce();
  });

  it("keeps nothing of a download that fails, such as one over the size cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-inbox-files-"));
    roots.push(root);
    const files = new MessagingInboxFiles(root);
    await files.remember("conn-1", "D1", "1.000", new Date().toISOString(), [file("F1GOOD")]);

    const tooLarge = vi.fn(async (_url: string, destination: string, maxBytes: number) => {
      expect(maxBytes).toBe(INBOX_FILE_MAX_BYTES);
      await writeFile(destination, "partial");
      throw new Error("too_large");
    });
    expect(await files.image("conn-1", "F1GOOD", tooLarge)).toBeNull();
    await expect(readFile(join(root, "conn-1", "bytes", "F1GOOD.part"))).rejects.toThrow();
    await expect(readFile(join(root, "conn-1", "bytes", "F1GOOD"))).rejects.toThrow();
  });
});
