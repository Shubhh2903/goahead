import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { MessagingInboxReply } from "./MessagingInboxReply";

describe("MessagingInboxReply", () => {
  it("Send posts the reply and clears the box", async () => {
    const sendInboxReply = vi.fn(async (_text: string) => undefined);
    render(() => <MessagingInboxReply onSend={sendInboxReply} />);

    const box = screen.getByRole("textbox", { name: "Reply as you" });
    await fireEvent.input(box, { target: { value: "  On my way  " } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(sendInboxReply).toHaveBeenCalledWith("On my way"));
    await waitFor(() => expect(box).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Send is disabled for empty text", async () => {
    const sendInboxReply = vi.fn(async (_text: string) => undefined);
    render(() => <MessagingInboxReply onSend={sendInboxReply} />);

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await fireEvent.input(screen.getByRole("textbox", { name: "Reply as you" }), { target: { value: "   " } });
    expect(send).toBeDisabled();
  });

  it("a failed send keeps the text and shows the error", async () => {
    const sendInboxReply = vi.fn(async (_text: string) => {
      throw new Error("not_in_channel");
    });
    render(() => <MessagingInboxReply onSend={sendInboxReply} />);

    const box = screen.getByRole("textbox", { name: "Reply as you" });
    await fireEvent.input(box, { target: { value: "Hello" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Slack did not accept the reply.");
    expect(box).toHaveValue("Hello");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});
