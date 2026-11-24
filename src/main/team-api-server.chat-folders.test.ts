// @vitest-environment node

// `chat-folders-v1`: `src/main/team-api/route-chat-folders.ts`. Any member reads the sidebar layout
// with the parent of each folder, without the agents that the member cannot see.

import { join } from "node:path";
import { type AgentSummary, isAgentSummary } from "@openbot/contracts/ipc";
import { CHAT_FOLDERS_CAPABILITY, CHAT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/chat-folders-v1";
import { afterEach, describe, expect, it } from "vitest";
import opencodeFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { createAgents, createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("Team API chat folders", () => {
  it("needs the capability, and leaves out an agent that the member cannot see", async () => {
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
    const visible: AgentSummary = { ...source, id: "visible", provider: "claude", model: "claude-opus-5" };
    // No Team API protocol describes a Pi agent, so every member has it hidden.
    const hidden: AgentSummary = { ...source, id: "hidden", provider: "pi" };
    const chatIds = new Set([visible.id, hidden.id]);
    const fixture = await createTeamApiFixture("chat-folders", { configure: true });
    const sidebarLayout = new SidebarLayoutStore(join(fixture.root, "sidebar-layout.json"));
    await sidebarLayout.initialize();
    const created = await sidebarLayout.mutate({ type: "create", name: "Core", agentId: visible.id }, chatIds);
    const sectionId = created.sections[0]?.id ?? null;
    await sidebarLayout.mutate({ type: "move-agent", agentId: hidden.id, sectionId, beforeAgentId: null }, chatIds);
    expect(sidebarLayout.getSnapshot().agentOrder).toEqual(expect.arrayContaining([visible.id, hidden.id]));

    const { base } = await fixture.start({
      agents: createAgents({ listAgents: () => [visible, hidden], sidebarChatIds: () => chatIds }),
      sidebarLayout,
    });
    await fixture.signIn();
    const invite = await fixture.store.createInvite("member");
    const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
    const read = (capabilities: string) =>
      fetch(`${base}${CHAT_FOLDERS_ROUTES.read}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${member.sessionToken}`,
          "OpenBot-Protocol-Version": "6",
          "OpenBot-Capabilities": capabilities,
          "Content-Type": "application/json",
        },
        body: "{}",
      });

    // Without the capability the route answers 400: the connection did not ask for the feature.
    expect((await read("")).status).toBe(400);

    const response = await read(CHAT_FOLDERS_CAPABILITY);
    expect(response.status).toBe(200);
    const layout = await response.json();
    expect(layout.agentAssignments).toEqual({ [visible.id]: sectionId });
    expect(layout.agentOrder).toContain(visible.id);
    expect(layout.agentOrder).not.toContain(hidden.id);
  });
});
