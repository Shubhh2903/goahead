import type { AgentEvent, AgentRuntimeApproval, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { type LiveActivityAction, liveActivityActionUrl } from "@openbot/team-client/live-activity-props";
import {
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityHostSecret,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { liveActivityRoute } from "./model/live-activity-link";
import { useLiveActivity } from "./use-live-activity";

const PHONE_SECRET = new Uint8Array(LIVE_ACTIVITY_SECRET_BYTES).fill(5);

// The alert, the widget runtime, the secure key store and the stored setting are native modules.
const native = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: native.alert } }));
vi.mock("./agent-live-activity", () => {
  const activity = { update: async () => undefined, end: async () => undefined, watchPushToken: () => () => undefined };
  const value = {
    starter: { start: () => activity, getInstances: () => [] },
    setSealKeys: () => undefined,
    saveAvatar: () => null,
    hasAvatar: () => false,
    renderBloub: () => null,
    removeAvatars: () => undefined,
  };
  return { agentLiveActivity: () => value };
});
vi.mock("./model/live-activity-keys", async () => {
  const seal = await import("@openbot/team-client/live-activity-seal");
  return {
    loadLiveActivitySecret: async () => PHONE_SECRET,
    liveActivityHostKeys: (phoneSecret: Uint8Array, serverId: string) => {
      const secret = seal.liveActivityHostSecret(phoneSecret, serverId);
      return { secret, keys: seal.liveActivityKeys(secret) };
    },
    resetLiveActivitySecret: async () => undefined,
  };
});
vi.mock("@/features/settings/model/live-activities", () => ({
  useLiveActivitiesPreference: {
    getState: () => ({ ready: true, enabled: false }),
    subscribe: () => () => undefined,
  },
}));

const actionKey = liveActivityKeys(liveActivityHostSecret(PHONE_SECRET, "server-1")).action;
const approval: AgentRuntimeApproval = {
  truncated: false,
  requestId: 7,
  agentId: "ada",
  threadId: "thread-ada",
  turnId: "turn-1",
  kind: "command",
  command: "npm test",
  cwd: null,
  reason: null,
  grantRoot: null,
  permissions: null,
};
const accept = (agentId = "ada"): LiveActivityAction => ({
  type: "respond-approval",
  serverId: "server-1",
  agentId,
  requestId: 7,
  decision: "accept",
});
const snapshot = (pendingApprovals: AgentRuntimeApproval[]): AgentEvent => ({
  type: "runtime-snapshot",
  snapshot: {
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals,
    pendingBrowserTakeovers: [],
    failedTurns: [],
  },
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  vi.clearAllMocks();
});

async function mount() {
  const post = vi.fn(async (_serverId: string, _path: string, _body: unknown) => undefined);
  let apply: (serverId: string, event: AgentEvent | TeamRealtimeEvent) => void = () => undefined;
  const servers: Pick<MobileServer, "id" | "state">[] = [{ id: "server-1", state: "online" }];
  const liveState = new LiveWorkspaceStore();
  function Host() {
    const handler = useLiveActivity({
      servers,
      activeServerId: "server-1",
      agents: [],
      liveState,
      foreground: true,
      post,
      loadAgentAvatar: async () => "",
      supportsPush: () => false,
    });
    useLayoutEffect(() => {
      apply = handler;
    }, [handler]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(() => root.render(<Host />));
  // The phone secret loads, and the hook gives the link keys.
  await act(async () => undefined);
  return {
    post,
    event: (event: AgentEvent) => act(() => apply("server-1", event)),
    tap: (action: LiveActivityAction, command: string) =>
      act(() => {
        liveActivityRoute(liveActivityActionUrl(action, actionKey, command), false);
      }),
  };
}

const alertTitles = () => native.alert.mock.calls.map((call) => call[0]);

it("asks to confirm Approve only when the same agent waits for the same command, after the host state loads", async () => {
  const host = await mount();
  await host.tap(accept(), "npm test");
  // The phone does not know the prompts of the host yet, so it waits.
  expect(native.alert).not.toHaveBeenCalled();

  await host.event(snapshot([approval]));
  expect(alertTitles()).toEqual(["Approve this command?"]);
  expect(native.alert.mock.calls[0]?.[1]).toBe("npm test");
  expect(host.post).not.toHaveBeenCalled();

  const approve = native.alert.mock.calls[0]?.[2]?.[1];
  await act(() => approve?.onPress());
  await vi.waitFor(() =>
    expect(host.post).toHaveBeenCalledWith("server-1", TEAM_API_ROUTES.respond.approval, {
      requestId: 7,
      decision: "accept",
    }),
  );
});

it("shows that the request changed, and posts nothing, for another agent, another command, or no request", async () => {
  const host = await mount();
  await host.event(snapshot([approval]));

  await host.tap(accept("grace"), "npm test");
  await host.tap(accept(), "rm -rf build");
  await host.event(snapshot([]));
  await host.tap(accept(), "npm test");

  expect(native.alert.mock.calls.map((call) => call[1])).toEqual([
    "The request changed. Open the chat to review it.",
    "The request changed. Open the chat to review it.",
    "The request changed. Open the chat to review it.",
  ]);
  expect(host.post).not.toHaveBeenCalled();
});
