// Frozen optional android-live-update-push-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member's Android
// phone gives the host its FCM registration token and a secret that only the phone and the host
// know. While the phone says it is away, the host sends the island state of this member to that
// token through the GoAhead relay and Firebase Cloud Messaging, sealed with keys made from the
// secret, so the relay and Google cannot read it. The phone shows it in one ongoing notification.
// The host keeps a registration in memory only, for the session that sent it, and forgets it when
// the session ends, when the phone removes it, or when FCM refuses the token. Widening any of it
// needs a second capability string. `live-activity-push-v1` stays the iPhone contract.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const ANDROID_LIVE_UPDATE_PUSH_CAPABILITY = "android-live-update-push-v1";

export const ANDROID_LIVE_UPDATE_PUSH_ROUTES = {
  register: "/v1/android-live-update/registration",
  remove: "/v1/android-live-update/registration/remove",
} as const;

export interface AndroidLiveUpdatePushRegistration {
  /** The phone's id for this host. The host puts it into the action links, which the phone reads. */
  serverId: string;
  /** The FCM registration token. */
  token: string;
  /** 32 random bytes as base64url. */
  secret: string;
  /** The interface language of the phone. The host uses English for a language it does not have. */
  locale: string;
  /** `true` while Android can stop the app. Only then does the host send updates. */
  away: boolean;
}

const pattern =
  (expression: RegExp, maximum: number): AdminDecoder =>
  (value) => {
    const text = string(maximum)(value);
    if (typeof text !== "string" || !expression.test(text)) throw new Error("Invalid Android live update value.");
    return text;
  };

const fcmToken = pattern(/^[A-Za-z0-9_:-]{32,4096}$/u, 4096);
const secret = pattern(/^[A-Za-z0-9_-]{43}$/u, 43);

export const ANDROID_LIVE_UPDATE_PUSH_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    ANDROID_LIVE_UPDATE_PUSH_ROUTES.register,
    adminRoute(
      fields({
        serverId: identifier,
        token: fcmToken,
        secret,
        locale: string(35),
        away: boolean,
      }),
      empty,
    ),
  ],
  [ANDROID_LIVE_UPDATE_PUSH_ROUTES.remove, adminRoute(empty, empty)],
]);
