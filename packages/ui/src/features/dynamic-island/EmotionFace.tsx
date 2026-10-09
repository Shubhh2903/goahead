import { animatedSvg, type EmotionId, emotionLabelKey, staticSvg } from "@openbot/brand/emotions";
import type { DynamicIslandGaze } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, onCleanup, onSettled, untrack } from "solid-js";

export interface EmotionFaceProps {
  emotion: EmotionId;
  class?: string;
  /** Where the pointer is, from main. Without it, an idle face still looks around by itself. */
  gaze?: DynamicIslandGaze;
}

/** Faces with nothing to do. Only these look around by themselves. */
const IDLE_EMOTIONS: ReadonlySet<EmotionId> = new Set(["neutral", "happy", "wink", "cute", "sleepy"]);
/** After this long with no pointer move, an idle face starts to look around. */
const WANDER_AFTER_MS = 5_000;
const WANDER_MIN_MS = 1_200;
const WANDER_MAX_MS = 3_600;
const WANDER_REACH = 0.8;
const CLICK_REACTION_MS = 1_500;
const WAKE_MS = 2_500;
const HOVER_WIGGLE_MS = 520;
const CLICK_BOUNCE_MS = 420;
const WIGGLE: Keyframe[] = [
  { transform: "rotate(0)" },
  { transform: "rotate(-9deg) scale(1.06)", offset: 0.25 },
  { transform: "rotate(7deg)", offset: 0.6 },
  { transform: "rotate(0)" },
];
const BOUNCE: Keyframe[] = [
  { transform: "translateY(0) scale(1)" },
  { transform: "translateY(-12%) scale(1.1)", offset: 0.35 },
  { transform: "translateY(3%) scale(0.97)", offset: 0.7 },
  { transform: "translateY(0) scale(1)" },
];
const CLICK_REACTIONS: readonly EmotionId[] = ["happy", "surprised"];

// The kit SVG goes in a shadow root, so its `<style>`, keyframe names and element ids stay out of
// the page. These rules add the look on top of the kit's own animation: `translate` and `rotate`
// are separate from the `transform` that the kit animates, so the two combine.
const LOOK_STYLE = `
:host { display: block; }
svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  transform-origin: 50% 60%;
  translate: calc(var(--emotion-look-x, 0) * 4%) calc(var(--emotion-look-y, 0) * 3%);
  rotate: calc(var(--emotion-look-x, 0) * 5deg);
  transition: translate 260ms ease-out, rotate 260ms ease-out;
}
.eye {
  translate: calc(var(--emotion-look-x, 0) * 6px) calc(var(--emotion-look-y, 0) * 5px);
  transition: translate 180ms ease-out;
}
:host([data-emotion="sleepy"]) .eye { translate: none; }
@media (prefers-reduced-motion: reduce) {
  svg, .eye { translate: none; rotate: none; transition: none; animation: none !important; }
}
`;

/**
 * The face that shows what agents do. It looks toward the pointer, looks around by itself when it
 * has nothing to do, wiggles on hover, and reacts to a click. All of this is only visual.
 * Reduce Motion shows the static face and turns the motion off.
 */
export function EmotionFace(props: EmotionFaceProps): JSX.Element {
  const { t } = useText();
  let host: HTMLSpanElement | undefined;
  // The island stays open for hours, so a Reduce Motion change must apply to the face it shows now.
  const [reducedMotion, setReducedMotion] = createSignal(prefersReducedMotion());
  // A face shown for a short time in place of the current one: a click reaction or a wake-up.
  const [reaction, setReaction] = createSignal<EmotionId>();
  const shown = () => reaction() ?? props.emotion;
  let reactionTimer: ReturnType<typeof setTimeout> | undefined;
  let wanderTimer: ReturnType<typeof setTimeout> | undefined;
  let lookFrame: number | undefined;
  let look = { x: 0, y: 0 };
  let near = false;
  // Plain copies for timers and listeners, which run outside the reactive scope.
  let emotion = untrack(() => props.emotion);
  let reduced = untrack(reducedMotion);

  function applyLook(next: { x: number; y: number }): void {
    look = next;
    if (lookFrame !== undefined) return;
    lookFrame = requestAnimationFrame(() => {
      lookFrame = undefined;
      host?.style.setProperty("--emotion-look-x", String(look.x));
      host?.style.setProperty("--emotion-look-y", String(look.y));
    });
  }

  let reacting: EmotionId | undefined;

  function react(next: EmotionId, durationMs: number): void {
    clearTimeout(reactionTimer);
    reacting = next;
    setReaction(next);
    reactionTimer = setTimeout(() => {
      reacting = undefined;
      setReaction(undefined);
    }, durationMs);
  }

  function playMotion(keyframes: Keyframe[], duration: number): void {
    const svg = host?.shadowRoot?.querySelector("svg");
    if (reduced || typeof svg?.animate !== "function") return;
    svg.animate(keyframes, { duration, easing: "ease-in-out" });
  }

  function scheduleWander(delayMs: number): void {
    clearTimeout(wanderTimer);
    wanderTimer = undefined;
    if (reduced || !IDLE_EMOTIONS.has(emotion)) return;
    wanderTimer = setTimeout(() => {
      const random = () => (Math.random() * 2 - 1) * WANDER_REACH;
      applyLook({ x: random(), y: random() * 0.6 });
      scheduleWander(WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS));
    }, delayMs);
  }

  // Draws the kit SVG in the shadow root each time the shown face or Reduce Motion changes.
  createEffect(
    () => (reducedMotion() ? staticSvg(shown()) : animatedSvg(shown())),
    (markup) => {
      if (host) renderFace(host, markup);
    },
  );

  // Each pointer move from main turns the eyes. A pointer that comes near wakes a sleepy face.
  createEffect(
    () => props.gaze,
    (gaze) => {
      if (!gaze || reduced) return;
      applyLook(emotion === "sleepy" ? { x: gaze.x * 0.3, y: gaze.y * 0.3 } : gaze);
      if (gaze.near && !near && emotion === "sleepy" && reacting === undefined) react("neutral", WAKE_MS);
      near = gaze.near;
      scheduleWander(WANDER_AFTER_MS);
    },
  );

  // A new face or a Reduce Motion change starts the idle look-around again, or stops it.
  createEffect(
    () => ({ emotion: props.emotion, reduced: reducedMotion() }),
    (next) => {
      emotion = next.emotion;
      reduced = next.reduced;
      if (reduced) applyLook({ x: 0, y: 0 });
      scheduleWander(WANDER_AFTER_MS);
    },
  );

  onSettled(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media?.matches ?? false);
    media?.addEventListener?.("change", sync);
    // A native listener, so the click stops before the island's own delegated click handlers.
    const click = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      const next = CLICK_REACTIONS.find((candidate) => candidate !== reacting && candidate !== emotion) ?? "happy";
      react(next, CLICK_REACTION_MS);
      playMotion(BOUNCE, CLICK_BOUNCE_MS);
    };
    const hover = () => playMotion(WIGGLE, HOVER_WIGGLE_MS);
    host?.addEventListener("click", click);
    host?.addEventListener("mouseenter", hover);
    return () => {
      media?.removeEventListener?.("change", sync);
      host?.removeEventListener("click", click);
      host?.removeEventListener("mouseenter", hover);
    };
  });

  onCleanup(() => {
    clearTimeout(reactionTimer);
    clearTimeout(wanderTimer);
    if (lookFrame !== undefined) cancelAnimationFrame(lookFrame);
  });

  return (
    <span
      ref={host}
      class={cx("dynamic-island-emotion-face", props.class)}
      role="img"
      aria-label={t(emotionLabelKey(shown()))}
      data-emotion={shown()}
    />
  );
}

/** Puts the kit SVG in the shadow root of `host`. The host carries the accessible name. */
function renderFace(host: HTMLElement, markup: string): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  const svg = host.ownerDocument.importNode(parsed, true);
  svg.removeAttribute("role");
  svg.removeAttribute("aria-labelledby");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const style = host.ownerDocument.createElement("style");
  style.textContent = LOOK_STYLE;
  root.replaceChildren(style, svg);
}
