import type { ChatBackdropScene } from "@openbot/contracts/chat-backdrop";
import { createEffect } from "solid-js";
import { REDUCED_MOTION_QUERY } from "../../utils";
import { paintChatBackdrop } from "./chat-backdrop";

/** The side of one mosaic cell, in CSS pixels. The canvas has one pixel for each cell. */
const CELL = 6;
/** A mosaic does not need more: 20 frames each second keeps the work small. */
const FRAME_MS = 50;
/** The moment that a still frame shows, when the system asks for less motion. */
const STILL_TIME = 42;

/**
 * An animated scene that fills the window under all of its content, on the scene's base color. It
 * stops while the window is hidden, and shows one still frame when the system asks for less motion.
 * The desktop window is dark only, so the scene paints its dark look.
 */
export function ChatBackdrop(props: { scene: ChatBackdropScene }) {
  let host: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  createEffect(
    () => props.scene,
    (scene) => {
      const box = host;
      const element = canvas;
      const context = element?.getContext("2d");
      if (!box || !element || !context) return;
      const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
      const start = performance.now();
      let width = 0;
      let height = 0;
      let visible = !document.hidden;
      let request = 0;
      let last = Number.NEGATIVE_INFINITY;

      const paint = (now: number) => {
        if (width === 0 || height === 0) return;
        const time = reducedMotion.matches ? STILL_TIME : (now - start) / 1000;
        paintChatBackdrop(context, { scene, width, height, time, dark: true });
      };
      const tick = (now: number) => {
        request = 0;
        if (now - last >= FRAME_MS) {
          last = now;
          paint(now);
        }
        schedule();
      };
      function schedule(): void {
        if (request !== 0 || !visible || reducedMotion.matches) return;
        request = window.requestAnimationFrame(tick);
      }
      const resize = () => {
        const nextWidth = Math.max(1, Math.ceil(box.clientWidth / CELL));
        const nextHeight = Math.max(1, Math.ceil(box.clientHeight / CELL));
        if (nextWidth === width && nextHeight === height) return;
        width = nextWidth;
        height = nextHeight;
        element.width = width;
        element.height = height;
        element.style.width = `${width * CELL}px`;
        element.style.height = `${height * CELL}px`;
        paint(performance.now());
      };
      const motionChanged = () => {
        paint(performance.now());
        schedule();
      };
      const visibilityChanged = () => {
        visible = !document.hidden;
        schedule();
      };

      const sizes = new ResizeObserver(resize);
      sizes.observe(box);
      reducedMotion.addEventListener("change", motionChanged);
      document.addEventListener("visibilitychange", visibilityChanged);
      resize();
      schedule();
      return () => {
        if (request !== 0) window.cancelAnimationFrame(request);
        sizes.disconnect();
        reducedMotion.removeEventListener("change", motionChanged);
        document.removeEventListener("visibilitychange", visibilityChanged);
      };
    },
  );
  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class="chat-backdrop"
      aria-hidden="true"
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
      />
    </div>
  );
}
