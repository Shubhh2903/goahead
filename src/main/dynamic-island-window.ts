import { isDeepStrictEqual } from "node:util";
import type {
  DynamicIslandAction,
  DynamicIslandNotchSize,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  EmotionId,
} from "@openbot/contracts/ipc";
import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  dynamicIslandCompactHeight,
  dynamicIslandEmotionsEnabled,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger, toLogValue } from "@openbot/logging";
import type { BrowserWindow, Display, Rectangle } from "electron";
import type { CriticalAction } from "./dynamic-island-actions";
import { readDynamicIslandPreference, writeDynamicIslandPreference } from "./dynamic-island-preference-store";
import { createEmotionGaze, type EmotionGaze, type EmotionGazeOptions, type EmotionGazeTarget } from "./emotion-gaze";
import { sendToRenderer } from "./renderer-ipc";

const logger = createOpenBotLogger("dynamic-island-window");

const DYNAMIC_ISLAND_WINDOW_SIZE = { width: 614, height: 380 } as const;
const DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT = 50;
// Room below the compact island for its hover growth and hit band, which the window must not clip.
const DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM = 18;
// Leaving interaction starts a collapse the renderer animates for roughly 600ms: the panel fades,
// then the shell springs back down to the notch. The window is the only thing clipping it, so
// dropping to the compact height on the same tick guillotines the still-tall island - the lower
// half disappears at once while the top morphs. Hold the tall window until the shell has landed.
export const DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS = 700;

// The face sits in the left ear of the island, about this far left of the notch edge.
const EMOTION_FACE_NOTCH_OFFSET = 26;
const EMOTION_FACE_SIZE = 20;
const EMOTION_FACE_TOP = 6;
const EMOTION_FACE_DEFAULT_NOTCH_WIDTH = 192;

const MACBOOK_NOTCH_REFERENCE = {
  displayWidth: 1512,
  displayHeight: 982,
  notchWidth: 185,
  notchHeight: 32,
} as const;
const MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE = 0.01;

export interface DynamicIslandWindowControllerOptions {
  platform: NodeJS.Platform;
  preferencePath: string;
  createWindow: (bounds: Rectangle, display: Display) => BrowserWindow;
  loadWindow: (window: BrowserWindow, display: Display) => Promise<void>;
  getDisplays: () => Display[];
  getMainWindow: () => BrowserWindow | null;
  ensureMainWindow?: () => Promise<BrowserWindow>;
  presentMainWindow: (window: BrowserWindow) => void;
  performHaptic: () => void;
  performCriticalAction: (action: CriticalAction) => Promise<void>;
  logger?: Logger;
  /** Lets the face follow the pointer. Without it, the face does not look around. */
  gaze?: Omit<EmotionGazeOptions, "targets">;
}

export class DynamicIslandWindowController {
  readonly #options: DynamicIslandWindowControllerOptions;
  #preference: DynamicIslandPreference = { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  // The presentation from the main renderer, with no face: main owns the face.
  #presentation: DynamicIslandPresentation = IDLE_DYNAMIC_ISLAND_PRESENTATION;
  #emotion: EmotionId | undefined;
  readonly #presentationListeners = new Set<(presentation: DynamicIslandPresentation) => void>();
  readonly #preferenceListeners = new Set<(preference: DynamicIslandPreference) => void>();
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #interactiveDisplays = new Set<number>();
  readonly #criticalActions = new Map<string, Promise<void>>();
  readonly #notchSizes = new Map<number, { width: number; height: number }>();
  readonly #collapseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  #preferenceMutation = Promise.resolve();
  #windowReconciliation = Promise.resolve();
  #destroyed = false;
  readonly #gaze: EmotionGaze | undefined;

  constructor(options: DynamicIslandWindowControllerOptions) {
    this.#options = options;
    this.#gaze = options.gaze && createEmotionGaze({ ...options.gaze, targets: () => this.#gazeTargets() });
  }

  /** The visible island windows that show a face, with about where the face is on the screen. */
  #gazeTargets(): EmotionGazeTarget[] {
    if (this.presentation.emotion === undefined) return [];
    const targets: EmotionGazeTarget[] = [];
    for (const [displayId, window] of this.#windows) {
      if (window.isDestroyed() || !window.isVisible()) continue;
      const bounds = window.getBounds();
      const notchWidth = this.#notchSizes.get(displayId)?.width ?? EMOTION_FACE_DEFAULT_NOTCH_WIDTH;
      targets.push({
        id: window.webContents.id,
        face: {
          x: bounds.x + bounds.width / 2 - notchWidth / 2 - EMOTION_FACE_NOTCH_OFFSET,
          y: bounds.y + EMOTION_FACE_TOP,
          width: EMOTION_FACE_SIZE,
          height: EMOTION_FACE_SIZE,
        },
        send: (gaze) => sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.gaze, gaze),
      });
    }
    return targets;
  }

  async initialize(): Promise<void> {
    this.#preference = await readDynamicIslandPreference(this.#options.preferencePath);
    await this.reconcileWindow();
    this.#notifyPreference();
  }

  get preference(): DynamicIslandPreference {
    return { ...this.#preference };
  }

  /** The presentation that the island windows show, with the face when emotions are on. */
  get presentation(): DynamicIslandPresentation {
    if (this.#emotion === undefined || !dynamicIslandEmotionsEnabled(this.#preference)) return this.#presentation;
    return { ...this.#presentation, emotion: this.#emotion };
  }

  /** Calls `listener` when the main renderer publishes a different presentation. */
  onPresentationChange(listener: (presentation: DynamicIslandPresentation) => void): () => void {
    this.#presentationListeners.add(listener);
    return () => this.#presentationListeners.delete(listener);
  }

  /** Calls `listener` with the preference after it is read and after each change. */
  onPreferenceChange(listener: (preference: DynamicIslandPreference) => void): () => void {
    this.#preferenceListeners.add(listener);
    return () => this.#preferenceListeners.delete(listener);
  }

  /** Sets the face that the island shows. Undefined shows the logo. */
  setEmotion(emotion: EmotionId | undefined): void {
    if (this.#emotion === emotion) return;
    const previous = this.presentation;
    this.#emotion = emotion;
    this.#sendPresentationIfChanged(previous);
    this.#gaze?.refresh();
  }

  /** The notch of the built-in display, or null when there is no built-in display or it has no notch. */
  get builtInDisplayGeometry(): DynamicIslandNotchSize | null {
    const builtIn = this.#options.getDisplays().find((display) => display.internal);
    return (builtIn && dynamicIslandNotchSizeForDisplay(builtIn)) ?? null;
  }

  get mainRendererIds(): ReadonlySet<number> {
    const window = this.#options.getMainWindow();
    return new Set(window && !window.isDestroyed() ? [window.webContents.id] : []);
  }

  get overlayRendererIds(): ReadonlySet<number> {
    return new Set(
      [...this.#windows.values()].filter((window) => !window.isDestroyed()).map((window) => window.webContents.id),
    );
  }

  async setPreference(preference: DynamicIslandPreference): Promise<DynamicIslandPreference> {
    let savedPreference: DynamicIslandPreference | undefined;
    const mutation = this.#preferenceMutation.then(async () => {
      savedPreference = await writeDynamicIslandPreference(this.#options.preferencePath, preference);
      const previousPresentation = this.presentation;
      this.#preference = savedPreference;
      await this.reconcileWindow();
      this.publishPreference();
      this.#sendPresentationIfChanged(previousPresentation);
      this.#notifyPreference();
      this.#gaze?.refresh();
    });
    this.#preferenceMutation = mutation.catch(() => undefined);
    await mutation;
    return { ...(savedPreference ?? preference) };
  }

  performHaptic(): void {
    if (!this.#preference.enabled || !this.#preference.hapticsEnabled) return;
    this.#options.performHaptic();
  }

  publish(presentation: DynamicIslandPresentation): void {
    // Main owns the face, so a face from the renderer is ignored.
    const { emotion: _rendererEmotion, ...withoutEmotion } = presentation;
    const next: DynamicIslandPresentation = withoutEmotion;
    if (isDeepStrictEqual(this.#presentation, next)) return;
    const previous = this.presentation;
    this.#presentation = next;
    this.#sendPresentationIfChanged(previous);
    for (const listener of this.#presentationListeners) listener(next);
  }

  #sendPresentationIfChanged(previous: DynamicIslandPresentation): void {
    const current = this.presentation;
    if (isDeepStrictEqual(previous, current)) return;
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, current);
    }
  }

  #notifyPreference(): void {
    for (const listener of this.#preferenceListeners) listener({ ...this.#preference });
  }

  setInteractive(rendererId: number, interactive: boolean, keyboard = false): void {
    const entry = [...this.#windows].find(
      ([, candidate]) => !candidate.isDestroyed() && candidate.webContents.id === rendererId,
    );
    if (!entry) return;
    const [displayId, window] = entry;
    if (interactive) this.#interactiveDisplays.add(displayId);
    else this.#interactiveDisplays.delete(displayId);
    const display = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
    const bounds = display ? dynamicIslandWindowBounds(display) : undefined;
    this.#cancelCollapse(displayId);
    if (interactive && bounds) window.setBounds(bounds, false);
    window.setIgnoreMouseEvents(!interactive, { forward: true });
    // On macOS, focusability also allows the panel to become a main window in AltTab. The panel is
    // focusable only while a text field on it needs key input. A panel becomes key without
    // activating the app, so the main window stays where it is.
    const wantsKeyboard = interactive && keyboard;
    window.setFocusable(wantsKeyboard);
    if (wantsKeyboard && !window.isFocused()) window.focus();
    if (interactive || !bounds) return;
    this.#collapseTimers.set(
      displayId,
      setTimeout(() => {
        this.#collapseTimers.delete(displayId);
        if (this.#interactiveDisplays.has(displayId) || window.isDestroyed()) return;
        // The display can be rearranged while the island animates shut, and reconciliation will
        // have moved the still-tall window to the new geometry. Ask where the window belongs now
        // rather than replaying the rectangle captured when the pointer left.
        const current = this.#options.getDisplays().find((candidate) => candidate.id === displayId);
        if (!current) return;
        window.setBounds(this.#windowBounds(current, dynamicIslandWindowBounds(current), false), false);
      }, DYNAMIC_ISLAND_COLLAPSE_SETTLE_MS),
    );
  }

  #windowBounds(display: Pick<Display, "bounds" | "internal">, bounds: Rectangle, interactive: boolean): Rectangle {
    if (interactive) return bounds;
    const compactHeight = dynamicIslandCompactHeight(
      notchSizeForDisplay(display)?.height,
      this.#preference.heightPercent,
    );
    return {
      ...bounds,
      height: Math.max(DYNAMIC_ISLAND_COMPACT_WINDOW_HEIGHT, compactHeight + DYNAMIC_ISLAND_COMPACT_WINDOW_HOVER_ROOM),
    };
  }

  #cancelCollapse(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  async performAction(action: DynamicIslandAction): Promise<void> {
    if (
      action.type === "answer-prompt" ||
      action.type === "respond-approval" ||
      action.type === "send-message" ||
      action.type === "stop-agent"
    ) {
      const key = criticalActionKey(action);
      const existing = this.#criticalActions.get(key);
      if (existing) return existing;
      const pending = this.#runCriticalAction(action);
      this.#criticalActions.set(key, pending);
      try {
        await pending;
      } finally {
        if (this.#criticalActions.get(key) === pending) this.#criticalActions.delete(key);
      }
      return;
    }
    const window = await this.#ensureMainWindow();
    // A dismissal changes only the island, so the main window stays where it is.
    if (action.type !== "dismiss-failure") this.#options.presentMainWindow(window);
    if (action.type !== "open-app" && !sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action)) {
      throw new Error(sourceText("error.backend.windowTemporarilyUnavailable"));
    }
  }

  async #runCriticalAction(action: CriticalAction): Promise<void> {
    // The main renderer clears an answered request at once. A reply or a stop changes only the
    // agent: its events reach the main window by themselves, so the island does not need it.
    const window =
      action.type === "answer-prompt" || action.type === "respond-approval" ? await this.#ensureMainWindow() : null;
    await this.#options.performCriticalAction(action);
    if (window) sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.action, action);
  }

  async #ensureMainWindow(): Promise<BrowserWindow> {
    const current = this.#options.getMainWindow();
    if (current && !current.isDestroyed()) return current;
    const created = await this.#options.ensureMainWindow?.();
    if (!created || created.isDestroyed()) throw new Error(sourceText("error.backend.windowUnavailable"));
    return created;
  }

  reconcileWindow(): Promise<void> {
    const reconciliation = this.#windowReconciliation.then(async () => {
      await this.#reconcileWindows();
      this.#gaze?.refresh();
    });
    this.#windowReconciliation = reconciliation.catch(() => undefined);
    return reconciliation;
  }

  async #reconcileWindows(): Promise<void> {
    if (this.#destroyed || this.#options.platform !== "darwin" || !this.#preference.enabled) {
      this.destroyWindows();
      return;
    }

    const displays = this.#options
      .getDisplays()
      .filter((display) => this.#preference.additionalDisplaysEnabled || display.internal);
    const displayIds = new Set(displays.map((display) => display.id));
    for (const [displayId, window] of this.#windows) {
      if (displayIds.has(displayId) && !window.isDestroyed()) continue;
      this.#windows.delete(displayId);
      this.#interactiveDisplays.delete(displayId);
      this.#notchSizes.delete(displayId);
      this.#cancelCollapse(displayId);
      if (!window.isDestroyed()) window.destroy();
    }

    for (const display of displays) {
      if (this.#destroyed) return;
      const bounds = dynamicIslandWindowBounds(display);
      const notchSize = notchSizeForDisplay(display);
      const current = this.#windows.get(display.id);
      if (current && !current.isDestroyed()) {
        current.setBounds(
          this.#windowBounds(
            display,
            bounds,
            this.#interactiveDisplays.has(display.id) || this.#collapseTimers.has(display.id),
          ),
          false,
        );
        if (notchSizeChanged(this.#notchSizes.get(display.id), notchSize)) {
          if (sendToRenderer(current, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
            this.#rememberNotchSize(display.id, notchSize);
          }
        }
        current.showInactive();
        continue;
      }
      try {
        await this.createDisplayWindow(display, bounds);
      } catch (error) {
        (this.#options.logger ?? logger).error(
          `Unable to load Dynamic Island on display ${display.id}:`,
          toLogValue(error),
        );
      }
    }
  }

  private async createDisplayWindow(display: Display, bounds: Rectangle): Promise<void> {
    const window = this.#options.createWindow(this.#windowBounds(display, bounds, false), display);
    window.excludedFromShownWindowsMenu = true;
    this.#windows.set(display.id, window);
    window.setHasShadow(false);
    window.setWindowButtonVisibility(false);
    window.setAlwaysOnTop(true, "status");
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setHiddenInMissionControl(true);
    window.setFocusable(false);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.on("did-finish-load", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      const currentDisplay = this.#options.getDisplays().find((candidate) => candidate.id === display.id) ?? display;
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.presentation, this.presentation);
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
      const notchSize = notchSizeForDisplay(currentDisplay);
      if (sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.geometry, notchSize ?? null)) {
        this.#rememberNotchSize(display.id, notchSize);
      }
    });
    window.once("ready-to-show", () => {
      if (this.#windows.get(display.id) !== window || window.isDestroyed()) return;
      window.showInactive();
    });
    window.on("blur", () => this.setInteractive(window.webContents.id, false));
    window.on("show", () => this.#gaze?.refresh());
    window.on("hide", () => this.#gaze?.refresh());
    window.on("closed", () => {
      if (this.#windows.get(display.id) === window) {
        this.#windows.delete(display.id);
        this.#interactiveDisplays.delete(display.id);
        this.#notchSizes.delete(display.id);
        this.#cancelCollapse(display.id);
      }
    });
    try {
      await this.#options.loadWindow(window, display);
    } catch (error) {
      if (this.#windows.get(display.id) === window) this.#windows.delete(display.id);
      this.#notchSizes.delete(display.id);
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  destroy(): void {
    this.#destroyed = true;
    this.#gaze?.dispose();
    this.destroyWindows();
  }

  private publishPreference(): void {
    for (const window of this.#windows.values()) {
      sendToRenderer(window, IPC_ENDPOINTS.dynamicIsland.preference, this.#preference);
    }
  }

  #rememberNotchSize(displayId: number, notchSize: DynamicIslandNotchSize | undefined): void {
    if (notchSize) this.#notchSizes.set(displayId, notchSize);
    else this.#notchSizes.delete(displayId);
  }

  private destroyWindows(): void {
    for (const displayId of [...this.#collapseTimers.keys()]) this.#cancelCollapse(displayId);
    const windows = [...this.#windows.values()];
    this.#windows.clear();
    this.#interactiveDisplays.clear();
    this.#notchSizes.clear();
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }
}

export function dynamicIslandNotchSizeForDisplay(
  display: Pick<Display, "bounds" | "internal">,
): DynamicIslandNotchSize | undefined {
  if (!display.internal || !isRecognizedNotchedMacBookDisplay(display)) return undefined;
  return dynamicIslandNotchSize(display);
}

function isRecognizedNotchedMacBookDisplay(display: Pick<Display, "bounds">): boolean {
  const { width, height } = display.bounds;
  if (width <= 0 || height <= 0) return false;
  const referenceAspectRatio = MACBOOK_NOTCH_REFERENCE.displayWidth / MACBOOK_NOTCH_REFERENCE.displayHeight;
  return Math.abs(width / height - referenceAspectRatio) <= MACBOOK_NOTCH_ASPECT_RATIO_TOLERANCE;
}

function notchSizeForDisplay(display: Pick<Display, "bounds" | "internal">): DynamicIslandNotchSize | undefined {
  return dynamicIslandNotchSizeForDisplay(display);
}

function notchSizeChanged(
  previous: { width: number; height: number } | undefined,
  next: { width: number; height: number } | undefined,
): boolean {
  return previous?.width !== next?.width || previous?.height !== next?.height;
}

function criticalActionKey(action: CriticalAction): string {
  const id =
    action.type === "send-message"
      ? action.clientMessageId
      : action.type === "stop-agent"
        ? action.turnId
        : String(action.requestId);
  return [action.type, action.serverId, action.agentId, id].join("\u0000");
}

function dynamicIslandWindowBounds(display: Pick<Display, "bounds">): Rectangle {
  return {
    x: Math.round(display.bounds.x + (display.bounds.width - DYNAMIC_ISLAND_WINDOW_SIZE.width) / 2),
    y: display.bounds.y,
    ...DYNAMIC_ISLAND_WINDOW_SIZE,
  };
}

/**
 * Returns the notch size in Electron's display points.
 *
 * Apple keeps the camera housing proportional across notched MacBooks, while
 * the selected display scale changes the logical display width. Scaling the
 * measured 14-inch reference therefore covers the 13-inch Air, 14-inch Pro,
 * 15-inch Air, and 16-inch Pro without a model-name lookup.
 */
function dynamicIslandNotchSize(display: Pick<Display, "bounds">): DynamicIslandNotchSize {
  const displayScale = display.bounds.width / MACBOOK_NOTCH_REFERENCE.displayWidth;
  return {
    width: Math.max(16, Math.round(MACBOOK_NOTCH_REFERENCE.notchWidth * displayScale)),
    height: Math.max(32, Math.round(MACBOOK_NOTCH_REFERENCE.notchHeight * displayScale)),
  };
}

export function requireDynamicIslandSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) {
    throw new Error(`Rejected Dynamic Island IPC request outside the ${name}.`);
  }
}
