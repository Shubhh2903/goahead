import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroDownloadSelector } from "../src/components/landing/HeroDownloadSelector";
import { OPENBOT_DOWNLOAD_LINKS } from "../src/lib/landing-links";

function setPlatform(platform: string): void {
  vi.stubGlobal("navigator", { platform, userAgent: "" });
}

describe("HeroDownloadSelector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("detects a Mac and links the macOS download", async () => {
    setPlatform("MacIntel");
    const view = render(() => <HeroDownloadSelector />);

    const download = await view.findByRole("link", { name: "Download for macOS" });
    expect(download).toHaveAttribute("href", OPENBOT_DOWNLOAD_LINKS.macos);
    expect(download).not.toHaveAttribute("target");
    expect(download).not.toHaveAttribute("rel");
  });

  it.each([
    ["Win32", "Windows: not available yet"],
    ["Linux x86_64", "Linux: not available yet"],
  ])("detects %s and offers no download", async (source, label) => {
    setPlatform(source);
    const view = render(() => <HeroDownloadSelector />);

    await waitFor(() => expect(view.getByText(label)).toHaveAttribute("aria-disabled", "true"));
    expect(view.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens with arrow keys and closes on Escape or an outside click", async () => {
    setPlatform("Win32");
    const view = render(() => <HeroDownloadSelector />);
    const trigger = view.getByRole("button", { name: "Choose download platform" });

    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await waitFor(() => view.getByRole("menu", { name: "Download platforms" }));
    await fireEvent.keyDown(menu, { key: "Escape" });
    expect(view.queryByRole("menu")).not.toBeInTheDocument();

    await fireEvent.click(trigger);
    await fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("links only macOS in the menu and marks Windows and Linux as coming soon", async () => {
    setPlatform("MacIntel");
    const view = render(() => <HeroDownloadSelector />);
    const trigger = view.getByRole("button", { name: "Choose download platform" });

    await fireEvent.click(trigger);
    await waitFor(() => view.getByRole("menu", { name: "Download platforms" }));
    expect(view.getByRole("menuitem", { name: "macOSAvailable" })).toHaveAttribute(
      "href",
      OPENBOT_DOWNLOAD_LINKS.macos,
    );
    for (const label of ["Windows", "Linux"]) {
      expect(view.getByRole("menuitem", { name: `${label}Coming soon` })).not.toHaveAttribute("href");
    }
  });
});
