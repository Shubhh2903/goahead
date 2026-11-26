import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type AgentLiveActivityProps, LIVE_ACTIVITY_STALE_AFTER_MS } from "@openbot/team-client/live-activity-props";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { currentText } from "@/shared/lib/text";
import { isLiveActivityLink } from "./live-activity-link";
import { openSealedLiveActivity } from "./live-activity-open";

/**
 * The Android form of the Live Activity: one ongoing notification that shows the island state. The
 * app updates it while it runs. While Android stops the app, the active host sends sealed updates
 * through FCM, and the background task opens them here with the keys of that host.
 */

export const ANDROID_LIVE_UPDATE_CHANNEL = "goahead-live-update";
const NOTIFICATION_ID = "goahead-live-update";
/** The seal keys of the active host, and the time of the shown content. The background task reads them. */
const STATE_KEY = "goahead.mobile.android-live-update.v1";

/** The props that the notification shows. The host and the app send the whole `AgentLiveActivityProps`. */
export type AndroidLiveUpdateView = Pick<
  AgentLiveActivityProps,
  "mode" | "title" | "label" | "detail" | "detailMarkdown" | "tint" | "tapUrl" | "rows" | "footer" | "buttons"
>;

/** The modes in which a prompt waits for the user. Only they get buttons. */
const PROMPT_MODES: ReadonlySet<AgentLiveActivityProps["mode"]> = new Set(["approval", "question"]);
/** Android shows at most three action buttons on a notification. */
const ACTION_LIMIT = 3;
const OPEN_ACTION = "open";

/** The buttons of the notification, and the link that each one opens. */
export interface AndroidLiveUpdateActions {
  /** Android category ids must not have `:` or `-`. */
  categoryIdentifier: string;
  actions: Notifications.NotificationAction[];
  /** The link of each action id. */
  links: Record<string, string>;
}

interface StoredState {
  seal: string;
  tag: string;
  /** When the shown content was made, in seconds. An older host update is ignored. */
  shownAt: number;
}

let channelReady: Promise<void> | null = null;

/** A quiet channel: the notification is a status, not an alert. Android keeps the first settings. */
export function ensureAndroidLiveUpdateChannel(): Promise<void> {
  channelReady ??= (async () => {
    const { t } = currentText();
    await Notifications.setNotificationChannelAsync(ANDROID_LIVE_UPDATE_CHANNEL, {
      name: t("mobile.liveActivity.android.channel"),
      description: t("mobile.liveActivity.android.channelDescription"),
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      showBadge: false,
    });
  })().catch((error: unknown) => {
    channelReady = null;
    throw error;
  });
  return channelReady;
}

/**
 * Shows `props` in the ongoing notification, or replaces what it shows. After `staleAt`, in seconds,
 * the buttons only open the app, as the iPhone activity drops them: old answers can target a request
 * that is gone. Without it, the content goes out of date after the same time as a host update.
 */
export async function showAndroidLiveUpdate(
  props: AndroidLiveUpdateView,
  madeAt: number,
  staleAt = madeAt + LIVE_ACTIVITY_STALE_AFTER_MS / 1000,
): Promise<void> {
  await ensureAndroidLiveUpdateChannel();
  // Android reads the category when it shows the notification, so it gets the labels of this update.
  // Without the category the update still shows, with no buttons.
  const actions = androidLiveUpdateActions(props);
  const buttons =
    actions &&
    (await Notifications.setNotificationCategoryAsync(actions.categoryIdentifier, actions.actions).then(
      () => actions,
      () => null,
    ));
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: props.title,
      subtitle: props.label,
      body: notificationBody(props),
      color: props.tint,
      data: { url: props.tapUrl, actions: buttons?.links ?? {}, staleAt },
      ...(buttons ? { categoryIdentifier: buttons.categoryIdentifier } : {}),
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.LOW,
    },
    trigger: { channelId: ANDROID_LIVE_UPDATE_CHANNEL },
  });
  await markShown(madeAt);
}

export async function dismissAndroidLiveUpdate(madeAt: number): Promise<void> {
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  await markShown(madeAt);
}

/**
 * The buttons of the notification, as the iPhone Live Activity has them: the signed answers of a
 * waiting prompt, then Open. Other modes get none. Each button opens the app, which checks the
 * signature and, for Approve, asks the user first. A button never acts in the background.
 */
export function androidLiveUpdateActions(view: AndroidLiveUpdateView): AndroidLiveUpdateActions | null {
  if (!PROMPT_MODES.has(view.mode)) return null;
  const answers = view.buttons.filter((button) => isLiveActivityLink(button.url)).slice(0, ACTION_LIMIT);
  if (answers.length === 0) return null;
  const { t } = currentText();
  const entries = answers.map((button, index) => ({ id: `answer${index}`, title: button.label, url: button.url }));
  if (entries.length < ACTION_LIMIT && isLiveActivityLink(view.tapUrl)) {
    entries.push({ id: OPEN_ACTION, title: t("mobile.liveActivity.button.open"), url: view.tapUrl });
  }
  return {
    categoryIdentifier: `goahead_live_update_${view.mode}`,
    actions: entries.map((entry) => ({
      identifier: entry.id,
      buttonTitle: entry.title,
      options: { opensAppToForeground: true },
    })),
    links: Object.fromEntries(entries.map((entry) => [entry.id, entry.url])),
  };
}

/**
 * The link to open for a tap on the notification or one of its buttons, or `null`. The app reads it
 * as any Live Activity link, so only a valid signature can start an action. A button of out-of-date
 * content, or of content with no date, opens what a tap opens.
 */
export function androidLiveUpdateResponseUrl(data: unknown, actionIdentifier: string, now: number): string | null {
  if (!isDynamicRecord(data)) return null;
  const tap = isString(data.url) ? data.url : null;
  if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) return tap;
  if (!isNumber(data.staleAt) || now >= data.staleAt) return tap;
  const link = isDynamicRecord(data.actions) ? data.actions[actionIdentifier] : undefined;
  // An unknown button, or a link that is not ours, opens what a tap opens.
  return isString(link) && isLiveActivityLink(link) ? link : tap;
}

/** Whether the ongoing notification is on screen now. The user can remove it on newer Android versions. */
export async function androidLiveUpdateShown(): Promise<boolean> {
  const shown = await Notifications.getPresentedNotificationsAsync();
  return shown.some((notification) => notification.request.identifier === NOTIFICATION_ID);
}

/** Keeps the keys of the active host for the background task, or removes them after sign-out. */
export async function saveAndroidLiveUpdateKeys(keys: { seal: string; tag: string } | null): Promise<void> {
  if (!keys) {
    await SecureStore.deleteItemAsync(STATE_KEY);
    return;
  }
  const previous = await readState();
  await writeState({ ...keys, shownAt: previous?.shownAt ?? 0 });
}

/**
 * Shows one host update from FCM. It opens the seal with the keys of the active host, so an update
 * from another host, a changed message, or an update older than the shown content shows nothing.
 */
export async function receiveAndroidLiveUpdate(data: DynamicRecord): Promise<void> {
  if (data.kind !== "goahead-live-update") return;
  const state = await readState();
  // After sign-out there are no keys, and nothing of the removed workspace may show.
  if (!state) return;
  const timestamp = Number(data.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < state.shownAt) return;
  if (data.event === "end") {
    await dismissAndroidLiveUpdate(timestamp);
    return;
  }
  if (data.event !== "update" || typeof data.sealed !== "string") return;
  const text = openSealedLiveActivity(data.sealed, state.seal, state.tag);
  if (text === null) return;
  const view = parseView(text);
  const staleAt = Number(data.staleAt);
  if (view) await showAndroidLiveUpdate(view, timestamp, Number.isSafeInteger(staleAt) ? staleAt : undefined);
}

async function markShown(madeAt: number): Promise<void> {
  const state = await readState();
  if (state && madeAt > state.shownAt) await writeState({ ...state, shownAt: madeAt });
}

async function readState(): Promise<StoredState | null> {
  const stored = await SecureStore.getItemAsync(STATE_KEY);
  const value = stored ? parseJson(stored) : null;
  if (!isDynamicRecord(value)) return null;
  const { seal, tag, shownAt } = value;
  return isString(seal) && isString(tag) && isNumber(shownAt) ? { seal, tag, shownAt } : null;
}

function writeState(state: StoredState): Promise<void> {
  return SecureStore.setItemAsync(STATE_KEY, JSON.stringify(state));
}

/** Reads the fields the notification shows from the props that the host sealed. */
function parseView(text: string): AndroidLiveUpdateView | null {
  const value = parseJson(text);
  if (!isDynamicRecord(value)) return null;
  const { mode, title, label, detail, detailMarkdown, tint, tapUrl, footer } = value;
  const rows = Array.isArray(value.rows) ? value.rows.flatMap(readRow) : null;
  // The host drops the buttons when the seal is too long. The notification then has none.
  const buttons = Array.isArray(value.buttons) ? value.buttons.flatMap(readButton) : [];
  if (
    !isViewMode(mode) ||
    !isString(title) ||
    !isString(label) ||
    !isString(detail) ||
    !isBoolean(detailMarkdown) ||
    !isString(tint) ||
    !isString(tapUrl) ||
    !isString(footer) ||
    !rows
  ) {
    return null;
  }
  return { mode, title, label, detail, detailMarkdown, tint, tapUrl, footer, rows, buttons };
}

const VIEW_MODES: ReadonlySet<string> = new Set<AgentLiveActivityProps["mode"]>([
  "working",
  "message",
  "question",
  "approval",
  "takeover",
  "failed",
  "mail",
]);

function isViewMode(value: unknown): value is AgentLiveActivityProps["mode"] {
  return isString(value) && VIEW_MODES.has(value);
}

function readButton(button: unknown): AndroidLiveUpdateView["buttons"] {
  return isDynamicRecord(button) && isString(button.label) && isString(button.url) && isBoolean(button.prominent)
    ? [{ label: button.label, url: button.url, prominent: button.prominent }]
    : [];
}

function readRow(row: unknown): AndroidLiveUpdateView["rows"] {
  return isDynamicRecord(row) && isString(row.name) && isString(row.text) ? [{ name: row.name, text: row.text }] : [];
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The notification shows plain text: the agents that work, or the detail, then the footer. */
function notificationBody(props: AndroidLiveUpdateView): string {
  const lines =
    props.rows.length > 0
      ? props.rows.map((row) => `${row.name}: ${plainText(row.text)}`)
      : [props.detailMarkdown ? plainText(props.detail) : props.detail];
  if (props.footer) lines.push(props.footer);
  return lines.filter(Boolean).join("\n");
}

/** Inline Markdown without its marks, as the island text uses only emphasis and code. */
function plainText(markdown: string): string {
  return markdown.replace(/(\*\*|__|\*|_|`)(.+?)\1/gu, "$2");
}
