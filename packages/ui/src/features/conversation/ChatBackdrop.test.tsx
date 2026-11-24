import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBackdrop } from "./ChatBackdrop";
import { CustomBackdrop } from "./CustomBackdrop";

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("ChatBackdrop motion", () => {
  const fillRect = vi.fn();
  const requestFrame = vi.fn(() => 1);
  const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");

  beforeEach(() => {
    // jsdom has no canvas and no layout: a context that records paint, and a window of 600 x 400.
    const context = {
      fillRect,
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      globalAlpha: 1,
      fillStyle: "",
    };
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => context });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    if (getContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", getContext);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fillRect.mockClear();
    requestFrame.mockClear();
  });

  it("paints one still frame and asks for no animation frame when the system asks for less motion", async () => {
    stubReducedMotion(true);
    render(() => <ChatBackdrop scene="pond" />);
    await vi.waitFor(() => expect(fillRect).toHaveBeenCalled());
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("animates when the system allows motion", async () => {
    stubReducedMotion(false);
    render(() => <ChatBackdrop scene="pond" />);
    await vi.waitFor(() => expect(requestFrame).toHaveBeenCalled());
  });
});

describe("CustomBackdrop video motion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not play a video when the system asks for less motion", async () => {
    stubReducedMotion(true);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    render(() => <CustomBackdrop kind="video" url="openbot-backdrop://file/x" />);
    await vi.waitFor(() => expect(pause).toHaveBeenCalled());
    expect(play).not.toHaveBeenCalled();
  });

  it("plays a video when the system allows motion", async () => {
    stubReducedMotion(false);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    render(() => <CustomBackdrop kind="video" url="openbot-backdrop://file/x" />);
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
  });
});
