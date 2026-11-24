import type { ReadStream } from "node:fs";
import { open } from "node:fs/promises";

export type ByteRange = { kind: "full" } | { kind: "range"; start: number; end: number } | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/u;

/**
 * The part of a file of `size` bytes that one `Range` header asks for. No header is the full file.
 * A header with several ranges is answered with the full file too (RFC 9110 lets a server ignore
 * Range), so no multipart body is built. A malformed or unsatisfiable single range is `unsatisfiable`.
 */
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (header === null) return { kind: "full" };
  const value = header.trim();
  if (/^bytes=.*,/u.test(value)) return { kind: "full" };
  const match = SINGLE_RANGE.exec(value);
  const first = match?.[1] ?? "";
  const last = match?.[2] ?? "";
  if (!match || (first === "" && last === "")) return { kind: "unsatisfiable" };
  if (first === "") {
    // A suffix: the last n bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || (last !== "" && Number(last) < start)) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}

/**
 * Like `fileResponse`, and answers one HTTP byte range, so a media element can seek and loop.
 * 200 with `Accept-Ranges` for no range (or several), 206 with `Content-Range` for one range, and
 * 416 for one that the file cannot satisfy. Streams only the requested bytes. Rejects when the path
 * is not a regular file, so the caller still answers 404.
 */
export async function rangedFileResponse(
  path: string,
  headers: Record<string, string>,
  rangeHeader: string | null,
): Promise<Response> {
  const file = await open(path, "r");
  let streaming = false;
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Not a regular file.");
    const size = stats.size;
    const range = parseByteRange(rangeHeader, size);
    if (range.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
      });
    }
    const start = range.kind === "range" ? range.start : 0;
    const end = range.kind === "range" ? range.end : size - 1;
    const length = Math.max(0, end - start + 1);
    const body = length === 0 ? null : webStream(file.createReadStream({ start, end }));
    streaming = body !== null;
    const common = { ...headers, "Accept-Ranges": "bytes", "Content-Length": String(length) };
    if (range.kind === "full") return new Response(body, { status: 200, headers: common });
    return new Response(body, {
      status: 206,
      headers: { ...common, "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  } finally {
    // The read stream closes the file when it ends or is cancelled.
    if (!streaming) await file.close().catch(() => undefined);
  }
}

/** The bytes of a file read stream as the body of a protocol response. Cancel stops the read. */
function webStream(stream: ReadStream): ReadableStream<Uint8Array> {
  const chunks = stream[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(new Uint8Array(next.value));
    },
    cancel: () => {
      stream.destroy();
    },
  });
}
