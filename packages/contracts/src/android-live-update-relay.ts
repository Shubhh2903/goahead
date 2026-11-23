/**
 * One Android live update that a host asks the GoAhead account service to send through Firebase
 * Cloud Messaging. The content is sealed by the host with keys that only the phone knows, so the
 * service and Google forward it without reading it. The service builds a data-only FCM message
 * itself and adds no text, so a host cannot use it to send an ordinary notification. The phone opens
 * the seal and shows the content in its own ongoing notification.
 */
export interface AndroidLiveUpdateRelayPush {
  /** The FCM registration token of the phone. */
  token: string;
  /** `end` removes the notification, as the phone does when nothing needs the user. */
  event: "update" | "end";
  /** The sealed props, base64url. `null` for `end`. */
  sealed: string | null;
  /** When the host made the update, in seconds. The phone ignores an update older than the one it shows. */
  timestamp: number;
  /** When the phone marks the content out of date, in seconds, or `null`. */
  staleAt: number | null;
  /** `high` shows a change of state at once. `normal` is for a change inside one state, which Android can delay. */
  priority: "high" | "normal";
}

/** FCM takes 4 KB of data for each message. The other fields and the keys need the rest. */
export const ANDROID_LIVE_UPDATE_SEALED_LIMIT = 3_600;
/** An FCM registration token. It goes into a JSON body only, never into a path or a header. */
export const ANDROID_LIVE_UPDATE_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{32,4096}$/u;
