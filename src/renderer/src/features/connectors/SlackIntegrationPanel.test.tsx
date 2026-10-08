import type { MessagingConnection } from "@openbot/contracts/ipc";
import { SlackIntegrationPanel } from "@openbot/ui/features/settings/SlackIntegrationPanel";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

const connection: MessagingConnection = {
  workspaceId: "T1",
  platform: "slack",
  enabled: true,
  state: "connected",
  workspaceName: "Multi Code Genius",
  botUserId: "B1",
  userId: "U1",
  userName: "Shubham",
  missingScopes: [],
  retryAt: null,
  credentials: "saved",
  orchestratorAgentId: null,
  watchedChannels: [],
  sendGuards: { paused: false, quietHours: null, hourlyLimit: 20, sentLastHour: 0 },
};

function renderPanel(isDefault: boolean, onHandOverDefault = vi.fn()) {
  render(() => (
    <SlackIntegrationPanel
      agents={[]}
      connections={[connection]}
      busy={false}
      routing={{ T1: { isDefault, people: isDefault ? [{ slackUserId: "U2", displayName: "Preet" }] : [] } }}
      onConnectWorkspace={vi.fn()}
      onDisconnectWorkspace={vi.fn()}
      onReconnect={vi.fn()}
      onSetEnabled={vi.fn()}
      onAddOrchestrator={vi.fn()}
      onHandOverDefault={onHandOverDefault}
    />
  ));
  return onHandOverDefault;
}

describe("SlackIntegrationPanel routing", () => {
  it("settings shows the default line and hands over to the chosen person", async () => {
    const onHandOverDefault = renderPanel(true);

    expect(screen.getByText("This computer answers people who do not use GoAhead.")).toBeInTheDocument();
    await fireEvent.pointerDown(screen.getByRole("button", { name: "Hand over…" }), { button: 0 });
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Preet" }), { button: 0 });

    await waitFor(() => expect(onHandOverDefault).toHaveBeenCalledWith("T1", "U2"));
  });

  it("another computer's default shows no hand over", () => {
    renderPanel(false);

    expect(screen.getByText("Another person's computer answers people who do not use GoAhead.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand over…" })).not.toBeInTheDocument();
  });
});
