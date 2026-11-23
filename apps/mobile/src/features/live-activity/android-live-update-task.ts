import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { receiveAndroidLiveUpdate } from "./model/android-live-update";

/**
 * Android runs this when an FCM data message arrives while the app is in the background or stopped.
 * `index.ts` imports this file before the router, because Android starts the task without a screen,
 * and the task must be defined at the top level of the bundle.
 */
export const ANDROID_LIVE_UPDATE_TASK = "goahead-android-live-update";

if (process.env.EXPO_OS === "android") {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(ANDROID_LIVE_UPDATE_TASK, async ({ data }) => {
    // A tap on a notification also reaches this task. The app handles taps itself.
    if (!data || "actionIdentifier" in data) return;
    await receiveAndroidLiveUpdate(messageData(data.data)).catch(() => undefined);
  });
}

/** FCM gives the data payload as a JSON string on some Android versions, and as fields on others. */
function messageData(data: DynamicRecord): DynamicRecord {
  if (!isString(data.dataString)) return data;
  try {
    const value = JSON.parse(data.dataString);
    return isDynamicRecord(value) ? value : {};
  } catch {
    return {};
  }
}
