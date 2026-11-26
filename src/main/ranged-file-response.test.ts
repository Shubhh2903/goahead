// @vitest-environment node

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseByteRange, rangedFileResponse } from "./ranged-file-response";

describe("parseByteRange", () => {
  it.each([
    [null, { kind: "full" }],
    ["bytes=0-9", { kind: "range", start: 0, end: 9 }],
    ["bytes=90-", { kind: "range", start: 90, end: 99 }],
    ["bytes=-10", { kind: "range", start: 90, end: 99 }],
    ["bytes=-500", { kind: "range", start: 0, end: 99 }],
    ["bytes=50-500", { kind: "range", start: 50, end: 99 }],
    ["bytes=100-", { kind: "unsatisfiable" }],
    ["bytes=100-200", { kind: "unsatisfiable" }],
    ["bytes=-0", { kind: "unsatisfiable" }],
    ["bytes=9-3", { kind: "unsatisfiable" }],
    ["bytes=-", { kind: "unsatisfiable" }],
    ["bytes=a-b", { kind: "unsatisfiable" }],
    ["items=0-9", { kind: "unsatisfiable" }],
    // Several ranges: the full file, with no multipart body.
    ["bytes=0-9, 20-29", { kind: "full" }],
  ])("reads %s for a file of 100 bytes", (header, expected) => {
    expect(parseByteRange(header, 100)).toEqual(expected);
  });
});

describe("rangedFileResponse", () => {
  const bytes = randomBytes(200_000);
  const headers = { "Content-Type": "video/webm" };
  let directory = "";
  let path = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "openbot-ranged-response-"));
    path = join(directory, "loop.webm");
    await writeFile(path, bytes);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("serves the full file with 200 and says that it accepts ranges", async () => {
    const response = await rangedFileResponse(path, headers, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(response.headers.get("Content-Type")).toBe("video/webm");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it.each([
    ["bytes=1000-70999", 1000, 70_999],
    ["bytes=150000-", 150_000, 199_999],
    ["bytes=-4096", 195_904, 199_999],
  ])("serves only the bytes of %s with 206", async (range, start, end) => {
    const response = await rangedFileResponse(path, headers, range);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
    expect(response.headers.get("Content-Length")).toBe(String(end - start + 1));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(start, end + 1))).toBe(true);
  });

  it.each(["bytes=200000-", "bytes=x-y"])("answers 416 for %s", async (range) => {
    const response = await rangedFileResponse(path, headers, range);
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(`bytes */${bytes.length}`);
  });

  it("serves the full file with 200 for several ranges", async () => {
    const response = await rangedFileResponse(path, headers, "bytes=0-9,20-29");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("rejects a directory, so the caller answers 404", async () => {
    await expect(rangedFileResponse(directory, headers, null)).rejects.toThrow();
  });
});
