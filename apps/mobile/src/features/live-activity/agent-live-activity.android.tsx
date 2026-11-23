import type { AgentLiveActivityProps } from "@openbot/team-client/live-activity-props";
import * as Notifications from "expo-notifications";
import { Linking } from "react-native";
import type { AgentLiveActivityLoader, AgentLiveActivityNative } from "./agent-live-activity.types";
import { ANDROID_LIVE_UPDATE_TASK } from "./android-live-update-task";
import {
  androidLiveUpdateShown,
  dismissAndroidLiveUpdate,
  ensureAndroidLiveUpdateChannel,
  saveAndroidLiveUpdateKeys,
  showAndroidLiveUpdate,
} from "./model/android-live-update";
import type { LiveActivityInstance } from "./model/live-activity-sync";

/**
 * The Android form of the Live Activity: one ongoing notification. Its push token is the FCM token
 * of the phone, which the active host uses while Android stops the app. Without Firebase in the
 * build, the phone has no token, and only the app updates the notification.
 */
export const agentLiveActivity: AgentLiveActivityLoader = () => {
  native ??= createNative();
  return native;
};

let native: AgentLiveActivityNative | null = null;

function createNative(): AgentLiveActivityNative {
  let current: LiveActivityInstance<AgentLiveActivityProps> | null = null;
  // A notification from an earlier launch shows old state. The app shows its own state now.
  void dismissAndroidLiveUpdate(nowSeconds()).catch(() => undefined);
  // A tap opens the chat or the chat list, as the iPhone activity does.
  Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string") void Linking.openURL(url).catch(() => undefined);
  });
  return {
    starter: {
      start: (props) => {
        // Each update waits for the first show, so it does not find the notification missing.
        const shown = prepare().then(() => showAndroidLiveUpdate(props, nowSeconds()));
        const activity: LiveActivityInstance<AgentLiveActivityProps> = {
          update: async (next) => {
            await shown;
            // The user can remove the notification. The sync then starts a new one.
            if (current !== activity || !(await androidLiveUpdateShown())) throw new Error("The notification ended.");
            await showAndroidLiveUpdate(next, nowSeconds());
          },
          end: async () => {
            if (current === activity) current = null;
            await shown.catch(() => undefined);
            await dismissAndroidLiveUpdate(nowSeconds());
          },
          watchPushToken: (receive) => watchFcmToken(receive),
        };
        current = activity;
        void shown.catch(() => undefined);
        return activity;
      },
      getInstances: () => [],
    },
    setSealKeys: (keys) => {
      void saveAndroidLiveUpdateKeys(keys).catch(() => undefined);
    },
    // An Android notification shows no agent picture.
    saveAvatar: () => null,
    hasAvatar: () => false,
    renderBloub: () => null,
    removeAvatars: () => undefined,
  };
}

/** The channel, the permission to post (Android 13 and later), and the task for host updates. */
async function prepare(): Promise<void> {
  await ensureAndroidLiveUpdateChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) await Notifications.requestPermissionsAsync();
  await Notifications.registerTaskAsync(ANDROID_LIVE_UPDATE_TASK).catch(() => undefined);
}

/** Calls `receive` with the FCM token now and when it changes. A build without Firebase has none. */
function watchFcmToken(receive: (token: string) => void): () => void {
  let stopped = false;
  void prepare()
    .then(() => Notifications.getDevicePushTokenAsync())
    .then((token) => {
      if (!stopped && typeof token.data === "string") receive(token.data);
    })
    .catch(() => undefined);
  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === "string") receive(token.data);
  });
  return () => {
    stopped = true;
    subscription.remove();
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
