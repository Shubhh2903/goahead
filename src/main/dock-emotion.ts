// Shows the emotion face on the macOS Dock icon. The face PNGs are pre-rendered
// (`scripts/generate-emotion-dock-icons.ts`) and shipped in `icons/emotions` of the packaged
// resources. When emotions are off, the normal app icon comes back through `restoreIcon`.
import { join } from "node:path";
import { type EmotionId, emotionDockIconFileName } from "@openbot/contracts/ipc";

/** The shortest time between two Dock icon changes. A later change waits, and only the newest applies. */
export const DOCK_EMOTION_MIN_INTERVAL_MS = 1_000;

export interface DockEmotionOptions {
  platform: NodeJS.Platform;
  /** The PNG path of a face. */
  resolveIconPath: (emotion: EmotionId) => string;
  /** Sets the Dock icon from a PNG path. Returns false when the image cannot be read. */
  setIcon: (path: string) => boolean;
  /** Sets the normal app icon again, with the chosen logo color. */
  restoreIcon: () => void;
  now: () => number;
  schedule: (run: () => void, delayMs: number) => { cancel: () => void };
}

export interface DockEmotion {
  /** The face to show, or undefined to show the normal app icon. */
  show: (emotion: EmotionId | undefined) => void;
  /** True while the Dock shows a face, so the logo color must not replace it. */
  readonly active: boolean;
  dispose: () => void;
}

export function resolveEmotionDockIconPath(options: {
  emotion: EmotionId;
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
}): string {
  const fileName = emotionDockIconFileName(options.emotion);
  return options.isPackaged
    ? join(options.resourcesPath, "icons", "emotions", fileName)
    : join(options.sourceRoot, "build", "emotions", fileName);
}

export function createDockEmotion(options: DockEmotionOptions): DockEmotion {
  const { platform, resolveIconPath, setIcon, restoreIcon, now, schedule } = options;
  // What the Dock shows now: a face, or undefined for the app icon.
  let shown: EmotionId | undefined;
  let wanted: EmotionId | undefined;
  let lastChangeAt = Number.NEGATIVE_INFINITY;
  let pending: { cancel: () => void } | undefined;
  let disposed = false;

  function apply(): void {
    pending = undefined;
    if (disposed || wanted === shown) return;
    const next = wanted;
    if (next === undefined) {
      shown = undefined;
      restoreIcon();
    } else if (setIcon(resolveIconPath(next))) {
      shown = next;
    } else {
      // A missing PNG must not leave an older face on the Dock.
      const hadFace = shown !== undefined;
      shown = undefined;
      if (hadFace) restoreIcon();
    }
    lastChangeAt = now();
  }

  return {
    show(emotion) {
      if (disposed || platform !== "darwin") return;
      wanted = emotion;
      // Restoring the app icon does not wait: the user turned the faces off.
      if (emotion === undefined) {
        pending?.cancel();
        apply();
        return;
      }
      if (pending) return;
      const waitMs = lastChangeAt + DOCK_EMOTION_MIN_INTERVAL_MS - now();
      if (waitMs <= 0) apply();
      else pending = schedule(apply, waitMs);
    },
    get active() {
      return shown !== undefined;
    },
    dispose() {
      disposed = true;
      pending?.cancel();
      pending = undefined;
    },
  };
}
