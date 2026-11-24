import { isDynamicRecord } from "./runtime-values";

/**
 * The animated scenes that can play behind the window. The identifiers are saved in
 * `openbot-chat-backdrop-v1.json`: add one, never rename one. A renamed identifier reads back as no
 * backdrop. The order is the Settings order.
 */
export const CHAT_BACKDROP_SCENES = ["pond", "jellyfish", "sunset", "snowfall", "fireflies"] as const;
export type ChatBackdropScene = (typeof CHAT_BACKDROP_SCENES)[number];

export function isChatBackdropScene(value: unknown): value is ChatBackdropScene {
  return CHAT_BACKDROP_SCENES.some((scene) => scene === value);
}

const UPLOAD_PREFIX = "upload:";
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A saved backdrop choice: a built-in scene, or `upload:<id>` of an image or video that the user added. */
export type ChatBackdropChoice = ChatBackdropScene | `upload:${string}`;

/** The id that main gives an upload: a lower-case UUID, so it is also a safe file name. */
export function isChatBackdropUploadId(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

export function isChatBackdropChoice(value: unknown): value is ChatBackdropChoice {
  if (isChatBackdropScene(value)) return true;
  return (
    typeof value === "string" &&
    value.startsWith(UPLOAD_PREFIX) &&
    isChatBackdropUploadId(value.slice(UPLOAD_PREFIX.length))
  );
}

export function uploadBackdropChoice(id: string): ChatBackdropChoice {
  return `upload:${id}`;
}

/** The id of an upload, or null for a built-in scene. */
export function uploadBackdropId(choice: ChatBackdropChoice): string | null {
  return choice.startsWith(UPLOAD_PREFIX) ? choice.slice(UPLOAD_PREFIX.length) : null;
}

export type ChatBackdropUploadKind = "image" | "video";

/** The file types that an upload can have. Main checks the extension and the file signature. */
export const CHAT_BACKDROP_UPLOAD_TYPES = {
  png: { mimeType: "image/png", kind: "image" },
  jpg: { mimeType: "image/jpeg", kind: "image" },
  jpeg: { mimeType: "image/jpeg", kind: "image" },
  gif: { mimeType: "image/gif", kind: "image" },
  webp: { mimeType: "image/webp", kind: "image" },
  avif: { mimeType: "image/avif", kind: "image" },
  mp4: { mimeType: "video/mp4", kind: "video" },
  webm: { mimeType: "video/webm", kind: "video" },
} as const satisfies Record<string, { mimeType: string; kind: ChatBackdropUploadKind }>;
export type ChatBackdropUploadExtension = keyof typeof CHAT_BACKDROP_UPLOAD_TYPES;

export function isChatBackdropUploadExtension(value: string): value is ChatBackdropUploadExtension {
  return Object.hasOwn(CHAT_BACKDROP_UPLOAD_TYPES, value);
}

/** Size limits in bytes, and how many uploads main keeps. */
export const CHAT_BACKDROP_UPLOAD_LIMITS = {
  image: 20 * 1_024 * 1_024,
  video: 100 * 1_024 * 1_024,
  count: 12,
  name: 80,
} as const;

export interface ChatBackdropUpload {
  id: string;
  name: string;
  kind: ChatBackdropUploadKind;
  createdAt: number;
}

/** The backdrop on this computer: the choice (null is none) and the uploads, oldest first. */
export interface ChatBackdropState {
  choice: ChatBackdropChoice | null;
  uploads: ChatBackdropUpload[];
}

type ChatBackdropUploadRefusal = "type" | "size";

export type ChatBackdropUploadResult =
  | { status: "added"; state: ChatBackdropState }
  | { status: "cancelled" }
  | { status: "refused"; reason: ChatBackdropUploadRefusal };

/** The address that main serves an upload at. Only an id in main's index answers. */
export function chatBackdropUploadUrl(id: string): string {
  return `openbot-backdrop://file/${id}`;
}

export function parseChatBackdropUpload(value: unknown): ChatBackdropUpload | null {
  if (!isDynamicRecord(value)) return null;
  const { id, name, kind, createdAt } = value;
  if (!isChatBackdropUploadId(id) || typeof name !== "string" || name.length > CHAT_BACKDROP_UPLOAD_LIMITS.name) {
    return null;
  }
  if (kind !== "image" && kind !== "video") return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return { id, name, kind, createdAt };
}

export function parseChatBackdropState(value: unknown): ChatBackdropState | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.uploads)) return null;
  const choice = value.choice === null ? null : isChatBackdropChoice(value.choice) ? value.choice : undefined;
  if (choice === undefined) return null;
  const uploads: ChatBackdropUpload[] = [];
  for (const item of value.uploads) {
    const upload = parseChatBackdropUpload(item);
    if (!upload) return null;
    uploads.push(upload);
  }
  return { choice, uploads };
}
