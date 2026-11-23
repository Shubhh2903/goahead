import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_NONCE_BYTES,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
  sealLiveActivity,
} from "@openbot/team-client/live-activity-seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { receiveAndroidLiveUpdate, saveAndroidLiveUpdateKeys } from "./android-live-update";

// Device storage and the notification runtime are the integration boundary.
const native = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  schedule: vi.fn(async (_request: unknown) => "goahead-live-update"),
  dismiss: vi.fn(async (_identifier: string) => undefined),
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
const props = {
  title: "Ada",
  label: "Approval",
  detail: "Run **npm test**?",
  detailMarkdown: true,
  tint: "#FF9500",
  tapUrl: "goahead://live-activity/open?agent=ada",
  rows: [],
  footer: "",
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
