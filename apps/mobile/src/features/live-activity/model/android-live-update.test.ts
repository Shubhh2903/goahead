import {
  type AgentLiveActivityProps,
  LIVE_ACTIVITY_URL,
  type LiveActivityAction,
  liveActivityActionUrl,
} from "@openbot/team-client/live-activity-props";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_NONCE_BYTES,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
  sealLiveActivity,
} from "@openbot/team-client/live-activity-seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  androidLiveUpdateActions,
  androidLiveUpdateResponseUrl,
  receiveAndroidLiveUpdate,
  saveAndroidLiveUpdateKeys,
} from "./android-live-update";
import {
  type LiveActivityRequest,
  liveActivityRoute,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityLinkKeys,
} from "./live-activity-link";

// Device storage and the notification runtime are the integration boundary.
const native = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  schedule: vi.fn(async (_request: { content: { data?: unknown } }) => "goahead-live-update"),
  dismiss: vi.fn(async (_identifier: string) => undefined),
  setCategory: vi.fn(async (_identifier: string, _actions: unknown[]) => null),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => native.storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.storage.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    native.storage.delete(key);
  },
}));
vi.mock("expo-notifications", () => ({
  AndroidImportance: { LOW: 4 },
  AndroidNotificationPriority: { LOW: "low" },
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  setNotificationCategoryAsync: native.setCategory,
  setNotificationChannelAsync: async () => null,
  scheduleNotificationAsync: native.schedule,
  dismissNotificationAsync: native.dismiss,
}));
vi.mock("@/shared/lib/text", async () => {
  const { textFor } = await import("../../../shared/lib/text-value");
  return { currentText: () => textFor("en") };
});

const secret = (fill: number) => Uint8Array.from({ length: LIVE_ACTIVITY_SECRET_BYTES }, () => fill);
const hostKeys = liveActivityKeys(secret(1));
const otherHostKeys = liveActivityKeys(secret(2));
const nonce = new Uint8Array(LIVE_ACTIVITY_NONCE_BYTES).fill(3);
const noButtons: AgentLiveActivityProps["buttons"] = [];
const props = {
  mode: "approval" as const,
  title: "Ada",
  label: "Approval",
  detail: "Run **npm test**?",
  detailMarkdown: true,
  tint: "#FF9500",
  tapUrl: "goahead://live-activity/open?agent=ada",
  rows: [],
  footer: "",
  buttons: noButtons,
};
const message = (sealed: string, timestamp: number) => ({
  kind: "goahead-live-update",
  event: "update",
  sealed,
  timestamp: String(timestamp),
  staleAt: String(timestamp + 900),
});

beforeEach(async () => {
  native.storage.clear();
  native.schedule.mockClear();
  native.dismiss.mockClear();
  native.setCategory.mockClear();
  resetLiveActivityActions();
  await saveAndroidLiveUpdateKeys({
    seal: encodeLiveActivityBytes(hostKeys.seal),
    tag: encodeLiveActivityBytes(hostKeys.tag),
  });
});

describe("Android live update from FCM", () => {
  it("shows what the active host sealed, as plain text in the ongoing notification", async () => {
    await receiveAndroidLiveUpdate(message(sealLiveActivity(JSON.stringify(props), hostKeys, nonce), 100));

    expect(native.schedule).toHaveBeenCalledTimes(1);
    expect(native.schedule.mock.calls[0]?.[0]).toMatchObject({
      identifier: "goahead-live-update",
      content: { title: "Ada", subtitle: "Approval", body: "Run npm test?", sticky: true, data: { url: props.tapUrl } },
    });
  });

  it("shows nothing from another host, a changed message, an older update, or after sign-out", async () => {
    await receiveAndroidLiveUpdate(message(sealLiveActivity(JSON.stringify(props), otherHostKeys, nonce), 100));
    const sealed = sealLiveActivity(JSON.stringify(props), hostKeys, nonce);
    await receiveAndroidLiveUpdate(message(`${sealed.slice(0, -2)}AA`, 100));
    expect(native.schedule).not.toHaveBeenCalled();

    await receiveAndroidLiveUpdate(message(sealed, 200));
    await receiveAndroidLiveUpdate(message(sealed, 150));
    await receiveAndroidLiveUpdate({ kind: "goahead-live-update", event: "end", timestamp: "120" });
    expect(native.schedule).toHaveBeenCalledTimes(1);
    expect(native.dismiss).not.toHaveBeenCalled();

    await saveAndroidLiveUpdateKeys(null);
    await receiveAndroidLiveUpdate(message(sealed, 300));
    expect(native.schedule).toHaveBeenCalledTimes(1);
  });
});

const DEFAULT_TAP = "expo.modules.notifications.actions.DEFAULT";
const tapUrl = `${LIVE_ACTIVITY_URL}?server=server-1&agent=ada`;
const approval = (decision: "accept" | "decline", requestId = 7): LiveActivityAction => ({
  type: "respond-approval",
  serverId: "server-1",
  agentId: "ada",
  requestId,
  decision,
});
/** The approval props as the host builds them: Decline, then Approve with the command it runs. */
const approvalProps = (
  actionKey: Uint8Array,
  requestId = 7,
): typeof props & Pick<AgentLiveActivityProps, "buttons"> => ({
  ...props,
  tapUrl,
  buttons: [
    {
      label: "Decline",
      prominent: false,
      url: liveActivityActionUrl(approval("decline", requestId), actionKey, "npm test"),
    },
    {
      label: "Approve",
      prominent: true,
      url: liveActivityActionUrl(approval("accept", requestId), actionKey, "npm test"),
    },
  ],
});
/** The data of the shown notification. */
const shownData = () => native.schedule.mock.calls.at(-1)?.[0].content.data;
/** What the app does with a tap on button `id` of the shown notification, at `now` in seconds. */
const tapButton = (id: string, now = 150): string | null => {
  const url = androidLiveUpdateResponseUrl(shownData(), id, now);
  return url === null ? null : liveActivityRoute(url);
};

describe("Android live update buttons", () => {
  it("offers Decline, Approve and Open only while a prompt waits, and each one opens the app", async () => {
    await receiveAndroidLiveUpdate(
      message(sealLiveActivity(JSON.stringify(approvalProps(hostKeys.action)), hostKeys, nonce), 100),
    );

    expect(native.setCategory).toHaveBeenCalledWith("goahead_live_update_approval", [
      { identifier: "answer0", buttonTitle: "Decline", options: { opensAppToForeground: true } },
      { identifier: "answer1", buttonTitle: "Approve", options: { opensAppToForeground: true } },
      { identifier: "open", buttonTitle: "Open", options: { opensAppToForeground: true } },
    ]);
    expect(native.schedule.mock.calls[0]?.[0]).toMatchObject({
      content: { categoryIdentifier: "goahead_live_update_approval" },
    });

    const question = {
      ...props,
      mode: "question" as const,
      tapUrl,
      buttons: [{ label: "Yes", prominent: true, url: approvalProps(hostKeys.action).buttons[0]?.url ?? "" }],
    };
    expect(androidLiveUpdateActions(question)?.actions.map((action) => action.buttonTitle)).toEqual(["Yes", "Open"]);
    // A plain activity update has no buttons, also when the props carry some.
    for (const mode of ["working", "message", "failed", "takeover"] as const) {
      expect(androidLiveUpdateActions({ ...approvalProps(hostKeys.action), mode })).toBeNull();
    }
    native.schedule.mockClear();
    await receiveAndroidLiveUpdate(
      message(sealLiveActivity(JSON.stringify({ ...props, mode: "working", tapUrl }), hostKeys, nonce), 200),
    );
    expect(native.schedule.mock.calls[0]?.[0]).not.toHaveProperty("content.categoryIdentifier");
  });

  it("asks the app to confirm Approve, with the signed command, and acts on no other link", async () => {
    setLiveActivityLinkKeys((serverId) =>
      serverId === "server-1" ? hostKeys.action : liveActivityKeys(secret(9)).action,
    );
    const receive = vi.fn<(request: LiveActivityRequest) => void>();
    const stop = onLiveActivityAction(receive);
    await receiveAndroidLiveUpdate(
      message(sealLiveActivity(JSON.stringify(approvalProps(hostKeys.action)), hostKeys, nonce), 100),
    );

    // A valid link reaches the app, which shows the command before it approves.
    expect(tapButton("answer1")).toBe("/chat/ada");
    expect(receive).toHaveBeenLastCalledWith({ action: approval("accept"), command: "npm test" });
    // A replay sends the same answer to the same prompt. The host refuses an answer to a prompt that is gone.
    expect(tapButton("answer1")).toBe("/chat/ada");
    expect(receive).toHaveBeenLastCalledWith({ action: approval("accept"), command: "npm test" });
    expect(tapButton("open")).toBe("/chat/ada");
    expect(tapButton(DEFAULT_TAP)).toBe("/chat/ada");
    expect(receive).toHaveBeenCalledTimes(2);
    receive.mockClear();

    const signed = new URL(approvalProps(hostKeys.action).buttons[1]?.url ?? "");
    const changed = (edit: (action: LiveActivityAction & { requestId: number }) => object) => {
      const payload = JSON.parse(signed.searchParams.get("action") ?? "{}");
      const url = new URL(signed);
      url.searchParams.set("action", JSON.stringify({ ...payload, action: edit(payload.action) }));
      return url.toString();
    };
    const links = [
      // A bad signature.
      `${signed.toString().slice(0, -2)}AA`,
      // The signature of one prompt on another prompt, agent or server.
      changed((action) => ({ ...action, requestId: 8 })),
      changed((action) => ({ ...action, agentId: "grace" })),
      changed((action) => ({ ...action, serverId: "server-2" })),
      // Signed with the key of another host.
      liveActivityActionUrl({ ...approval("accept"), serverId: "server-2" }, hostKeys.action, "npm test"),
      // Signed with the keys of a phone secret from before a sign-out, so it has expired.
      liveActivityActionUrl(approval("accept"), otherHostKeys.action, "npm test"),
    ];
    for (const link of links) expect(liveActivityRoute(link)).toBe("/");
    expect(receive).not.toHaveBeenCalled();
    stop();
  });

  it("opens the app only for a button tap before the keys load, or without keys", async () => {
    const receive = vi.fn<(request: LiveActivityRequest) => void>();
    const stop = onLiveActivityAction(receive);
    await receiveAndroidLiveUpdate(
      message(sealLiveActivity(JSON.stringify(approvalProps(hostKeys.action)), hostKeys, nonce), 100),
    );

    expect(tapButton("answer1")).toBe("/");
    expect(receive).not.toHaveBeenCalled();
    // The keys of this phone do not sign the link, so the waiting link does nothing when they load.
    setLiveActivityLinkKeys(() => otherHostKeys.action);
    expect(receive).not.toHaveBeenCalled();
    // A button link that is not a GoAhead link opens what a tap opens.
    expect(
      androidLiveUpdateResponseUrl(
        { url: tapUrl, actions: { answer1: "https://example.com" }, staleAt: 1000 },
        "answer1",
        150,
      ),
    ).toBe(tapUrl);
    stop();
  });

  it("opens only the chat from a button of out-of-date content, as the iPhone activity drops them", async () => {
    const sealed = sealLiveActivity(JSON.stringify(approvalProps(hostKeys.action)), hostKeys, nonce);
    const approveUrl = approvalProps(hostKeys.action).buttons[1]?.url;
    // The host says when the content goes out of date.
    await receiveAndroidLiveUpdate({ ...message(sealed, 100), staleAt: "400" });
    expect(androidLiveUpdateResponseUrl(shownData(), "answer1", 399)).toBe(approveUrl);
    expect(androidLiveUpdateResponseUrl(shownData(), "answer1", 400)).toBe(tapUrl);

    // Without a date, the content goes out of date after the period of a host update: 15 minutes.
    const { staleAt: _staleAt, ...undated } = message(sealed, 200);
    await receiveAndroidLiveUpdate(undated);
    expect(shownData()).toMatchObject({ staleAt: 200 + 15 * 60 });
    expect(androidLiveUpdateResponseUrl(shownData(), "answer1", 200 + 15 * 60 - 1)).toBe(approveUrl);
    expect(androidLiveUpdateResponseUrl(shownData(), "answer1", 200 + 15 * 60)).toBe(tapUrl);
    // Notification data with no date at all only opens the chat.
    expect(androidLiveUpdateResponseUrl({ url: tapUrl, actions: { answer1: approveUrl } }, "answer1", 0)).toBe(tapUrl);
  });
});
