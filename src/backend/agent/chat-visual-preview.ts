import type { ChatVisualAppearance } from "@openbot/contracts/chat-visual";

export interface ChatVisualPreviewRequest {
  html: string;
  width: number;
  appearance: ChatVisualAppearance;
}

export interface ChatVisualPreviewResult {
  /** A PNG data URL of the page at its content height, which the agent reads as an image. */
  imageUrl: string;
  contentHeight: number;
  console: string[];
}

/**
 * The page could not be drawn. The reason is safe to give to the agent, which can correct its page
 * and try again.
 */
export class ChatVisualPreviewFailed extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "ChatVisualPreviewFailed";
    this.reason = reason;
  }
}

/**
 * Draws a visual reply page out of view, in the sandbox that the chat gives it, so that the agent can
 * look at its page before it shows it. The main process owns the window.
 */
export interface ChatVisualPreviewHost {
  /** Rejects with `ChatVisualPreviewFailed` when the page cannot be drawn. */
  capture(request: ChatVisualPreviewRequest): Promise<ChatVisualPreviewResult>;
}
