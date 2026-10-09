import type { AgentHandoff } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { STORY_AGENT } from "../../preview/fixtures";
import { HandoffChatCard } from "./HandoffChatCard";
import type { HandoffsPort } from "./handoffs-port";

const agents = [
  { ...STORY_AGENT, id: "chief", name: "Chief" },
  { ...STORY_AGENT, id: "builder", name: "Builder" },
];

const working: AgentHandoff = {
  id: "delivery-1",
  messageId: "message-1",
  fromAgentId: "chief",
  toAgentId: "builder",
  task: "Add a Go server config to handling-1m-req.",
  startedAt: "2026-10-09T10:00:00.000Z",
  status: "working",
  steps: [
    { kind: "command", name: "go" },
    { kind: "edit", name: "go-server.go" },
  ],
  reply: null,
};

describe("HandoffChatCard", () => {
  it("a hand-off card shows the task, then the reply", async () => {
    let current = [working];
    let reload: () => void = () => undefined;
    const port: HandoffsPort = {
      list: vi.fn(async () => current),
      subscribe: (_agentId, next) => {
        reload = next;
        return () => undefined;
      },
    };
    render(() => (
      <HandoffChatCard
        agentId="chief"
        messageId="message-1"
        agents={agents}
        onSelectAgent={vi.fn()}
        fallback={<span>Messaged</span>}
        port={port}
      />
    ));

    const card = await screen.findByRole("article", { name: "Work from Chief to Builder: Editing go-server.go…" });
    expect(within(card).getByText("Add a Go server config to handling-1m-req.")).toBeInTheDocument();
    await fireEvent.click(within(card).getByRole("button", { name: "Show 2 steps" }));
    const steps = within(card).getByRole("list", { name: "Steps" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ran go", "Edited go-server.go"]);

    current = [{ ...working, status: "done", reply: "Status: done. Added go-server.go." }];
    reload();

    const done = await screen.findByRole("article", { name: "Work from Chief to Builder: Done" });
    expect(within(done).getByText("Status: done. Added go-server.go.")).toBeInTheDocument();
    expect(within(done).getByText("Reply from Builder")).toBeInTheDocument();
  });
});
