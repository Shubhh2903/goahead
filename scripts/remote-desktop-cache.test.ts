import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveCachePath,
  parseGitmodulesPaths,
  readCachedArchive,
  sha256Hex,
  submodulePlan,
  verifyPinnedCommit,
  withRetries,
} from "./remote-desktop-cache";

describe("remote desktop source cache", () => {
  it("names a cached archive by its sha256", () => {
    const sha = sha256Hex("a");
    expect(archiveCachePath("/c", sha)).toBe(join("/c", "archives", sha));
    expect(() => archiveCachePath("/c", "../x")).toThrow();
  });

  it("reuses an archive only when its hash matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "rd-cache-test-"));
    await mkdir(join(root, "archives"));
    const sha = sha256Hex("good");
    await writeFile(archiveCachePath(root, sha), "good");
    expect((await readCachedArchive(root, sha))?.toString()).toBe("good");
    const other = sha256Hex("expected");
    await writeFile(archiveCachePath(root, other), "tampered");
    expect(await readCachedArchive(root, other)).toBeNull();
    expect(await readCachedArchive(root, sha256Hex("missing"))).toBeNull();
  });

  it("plans submodule commands that use the mirror and restore the real URL", () => {
    const steps = submodulePlan({ name: "n", path: "third-party/x", url: "https://h/x.git", mirror: "/m/x.git" });
    expect(steps.map((s) => s.args)).toEqual([
      ["submodule", "init", "--", "third-party/x"],
      ["config", "submodule.n.url", "/m/x.git"],
      ["-c", "protocol.file.allow=always", "submodule", "update", "--", "third-party/x"],
      ["config", "submodule.n.url", "https://h/x.git"],
    ]);
    expect(parseGitmodulesPaths("submodule.a.b.path third-party/x\n").get("third-party/x")).toBe("a.b");
  });

  it("rejects a submodule commit that differs from the pin", () => {
    const pin = "a".repeat(40);
    expect(() => verifyPinnedCommit("p", pin, `${pin}\n`)).not.toThrow();
    expect(() => verifyPinnedCommit("p", pin, "b".repeat(40))).toThrow("Unexpected submodule commit");
    expect(() => verifyPinnedCommit("p", undefined, pin)).toThrow("not pinned");
  });

  it("retries a failing action three times", async () => {
    let calls = 0;
    await expect(
      withRetries(
        () => {
          calls += 1;
          throw new Error("clone died");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("clone died");
    expect(calls).toBe(3);
  });
});
