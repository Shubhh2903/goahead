import type { AppSetupState } from "@openbot/contracts/ipc";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { App } from "./App";
import { installOpenbotStub } from "./app-test-harness";

/** A profile whose setup file survives a "restart": the next render reads what the last one saved. */
function persistSetup(initial: AppSetupState): void {
  let stored = initial;
  vi.mocked(window.openbot.getSetupState).mockImplementation(async () => stored);
  vi.mocked(window.openbot.saveSetup).mockImplementation(async ({ preferredProvider, preferredModel }) => {
    stored = { completed: true, preferredProvider, preferredModel };
    return stored;
  });
}

const NEW_PROFILE: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

async function finishProviderStep(): Promise<void> {
  await screen.findByRole("heading", { name: "Meet GoAhead" });
  await fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await fireEvent.click(screen.getByRole("button", { name: "Open GoAhead" }));
}

describe("first-run wizard", () => {
  beforeEach(() => {
    installOpenbotStub();
  });

  it("takes a new user from the provider to the first agent, the connectors and the phone", async () => {
    persistSetup(NEW_PROFILE);
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    render(() => <App />);

    await finishProviderStep();
    expect(await screen.findByRole("heading", { name: "Create your first agent" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(window.openbot.agent.createAgent).toHaveBeenCalled());

    const connect = await screen.findByRole("dialog", { name: "Connect Slack and Gmail" });
    expect(within(connect).getByText("Setup step 3 of 4")).toBeInTheDocument();
    await fireEvent.click(within(connect).getByRole("button", { name: "Skip" }));

    const phone = await screen.findByRole("dialog", { name: "Connect your phone" });
    await fireEvent.click(within(phone).getByRole("button", { name: "Back" }));
    await fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Connect Slack and Gmail" })).getByRole("button", {
        name: "Next",
      }),
    );
    await fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Connect your phone" })).getByRole("button", {
        name: "Finish",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("skips the first agent and then the rest of the wizard", async () => {
    persistSetup(NEW_PROFILE);
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    render(() => <App />);

    await finishProviderStep();
    await screen.findByRole("heading", { name: "Create your first agent" });
    await fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Create your first agent" })).not.toBeInTheDocument(),
    );

    const connect = await screen.findByRole("dialog", { name: "Connect Slack and Gmail" });
    await fireEvent.click(within(connect).getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.openbot.agent.createAgent).not.toHaveBeenCalled();
  });

  it("keeps a skip of the whole wizard across a restart", async () => {
    persistSetup(NEW_PROFILE);
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    render(() => <App />);

    await screen.findByRole("heading", { name: "Meet GoAhead" });
    await fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(window.openbot.saveSetup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Meet GoAhead" })).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Create your first agent" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    cleanup();
    render(() => <App />);
    // The setup is saved, so the app opens the workspace. An empty roster opens the agent form as it
    // did before the wizard, without the wizard's Skip.
    expect(await screen.findByRole("heading", { name: "Create your first agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Meet GoAhead" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(window.openbot.saveSetup).toHaveBeenCalledTimes(1);
  });

  it("never shows the wizard to a profile that already has agents", async () => {
    persistSetup(NEW_PROFILE);
    render(() => <App />);

    await finishProviderStep();
    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
    await waitFor(() => expect(window.openbot.agent.listAgents).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Connect Slack and Gmail" })).not.toBeInTheDocument();
  });

  it("never shows the wizard when the old onboarding is done", async () => {
    persistSetup({ completed: true, preferredProvider: "codex", preferredModel: null });
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue([]);
    render(() => <App />);

    expect(await screen.findByRole("heading", { name: "Create your first agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Meet GoAhead" })).not.toBeInTheDocument();
  });
});
