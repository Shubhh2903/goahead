import { Button, Progress, TOAST_DURATION, toast } from "@openbot/ui";
import { createDigitRoll } from "@openbot/ui/digit-roll";
import { currentText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createRoot, createSignal, createUniqueId, onSettled, Show, untrack } from "solid-js";

/**
 * An update, as one notification the user acts on and then watches. The provider CLI updates and
 * the update of GoAhead itself both use it.
 *
 * The notification is raised once and held for the whole flow. This is the point of the module:
 * calling `toast()` a second time with the same id does not edit what is on screen, it reconciles
 * the store entry, and Solid rebuilds the list row from it. The `<li>` is thrown away for a new one
 * that mounts at zero height with the enter animation, and a download that reports every hundred
 * milliseconds does that a dozen times a second - which is the jumping this module exists to avoid.
 *
 * So everything that changes after the notification opens is a signal read inside the element that
 * is already there. The title is a function sonner calls again, and the detail and the action button
 * are elements built once, in their own reactive root, that update themselves in place.
 *
 * Two things follow from holding one toast open. Its dismiss timer cannot be re-armed, so the
 * settled notification counts itself out here. And the action button is ours rather than sonner's,
 * because sonner renders its own button for as long as an action exists, and an update that has
 * finished has nothing left to offer.
 *
 * The Toaster is already mounted once in `App.tsx`, outside every provider, and `toast` is the
 * handle onto it. The class names are the provider update's, styled in `provider-updates.css`.
 */

/** What one state of an update shows. */
export interface LiveUpdatePresentation {
  /** The state offers the update itself. */
  updatable: boolean;
  busy: boolean;
  failed: boolean;
  /** The one thing the notification offers, or nothing. */
  actionLabel: string | undefined;
  title: string;
  detail: string;
  /** The download percentage, or `null` for an indeterminate bar or no bar. */
  progress: number | null;
}

/** Sonner starts no dismiss timer for `POSITIVE_INFINITY`, which is what "held" means above. */
const PERSISTENT = Number.POSITIVE_INFINITY;

/** The progressbar beside it still reports the current value to assistive technology. */
function LiveUpdatePercent(props: { percent: number }): JSX.Element {
  const roll = createDigitRoll(() => props.percent);

  return (
    <span ref={roll.ref} class="provider-update-toast-percent t-digit-group" aria-hidden="true">
      <span class="t-digit">{roll.displayed()}%</span>
    </span>
  );
}

/**
 * One line naming the state, and - while the update runs - the bar reporting it on a line under it,
 * so the box the user pressed Update on answers in the same place.
 * A step with no measurable end has an indeterminate bar, and the percentage goes away rather than
 * sitting at a number that has stopped moving.
 *
 * A failure explains itself in a sentence that can be long. It wraps, stops after a few lines, and
 * a button under it opens the rest, so the words stay inside the box and Retry stays where it is.
 * The button is there only when lines are cut off. Whether they are is a measurement of the laid
 * out line, made again when the text or the width changes.
 */
function LiveUpdateDetail(props: {
  /** Colours the bar with the provider's colour, as `provider-updates.css` reads it. */
  barProvider: string | undefined;
  presentation: LiveUpdatePresentation;
  expanded: boolean;
  clamped: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onClampedChange: (clamped: boolean) => void;
}): JSX.Element {
  const { t } = currentText();
  const lineId = createUniqueId();
  let line: HTMLSpanElement | undefined;

  // An open line shows everything, so it cannot say whether the closed one cuts anything off.
  function measure(failed: boolean, expanded: boolean): void {
    if (!line || expanded) return;
    props.onClampedChange(failed && line.scrollHeight > line.clientHeight);
  }

  // The text is read here only so that a new sentence is measured again.
  createEffect(
    () => ({
      detail: props.presentation.detail,
      failed: props.presentation.failed,
      expanded: props.expanded,
    }),
    (state) => measure(state.failed, state.expanded),
  );
  // The toast is built before it is on screen, and its width can change after, so the first real
  // measurement comes from here.
  onSettled(() => {
    if (!line || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(props.presentation.failed, props.expanded));
    observer.observe(line);
    return () => observer.disconnect();
  });

  return (
    <>
      <span
        ref={(element) => (line = element)}
        id={lineId}
        class="provider-update-toast-line"
        data-failed={props.presentation.failed ? "true" : undefined}
        data-expanded={props.expanded ? "true" : undefined}
      >
        {props.presentation.detail}
      </span>
      <Show when={props.presentation.failed && (props.clamped || props.expanded)}>
        <Button
          variant="link"
          size="xs"
          class="provider-update-toast-details"
          aria-expanded={props.expanded ? "true" : "false"}
          aria-controls={lineId}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          {props.expanded ? t("update.provider.hideDetails") : t("update.provider.showDetails")}
        </Button>
      </Show>
      <Show when={props.presentation.busy}>
        <span class="provider-update-toast-progress">
          <Progress
            class="provider-update-toast-bar"
            data-provider={props.barProvider}
            value={props.presentation.progress ?? 0}
            indeterminate={props.presentation.progress === null}
            aria-label={props.presentation.title}
          />
          <Show when={props.presentation.progress !== null}>
            <LiveUpdatePercent percent={props.presentation.progress ?? 0} />
          </Show>
        </span>
      </Show>
    </>
  );
}

/**
 * What the one button says - Update, Retry or Restart - while staying the same button, so no word
 * changes rebuild anything under the reader. Sonner renders its action button for as long as an
 * action exists and cannot be given up without replacing the notification, so a state with nothing
 * to offer leaves a marker `provider-updates.css` uses to take the button out of the layout and out
 * of the accessibility tree.
 */
function LiveUpdateActionLabel(props: { presentation: LiveUpdatePresentation }): JSX.Element {
  return (
    <span class="provider-update-toast-action" data-idle={props.presentation.actionLabel ? undefined : "true"}>
      {props.presentation.actionLabel}
    </span>
  );
}

function samePresentation(a: LiveUpdatePresentation, b: LiveUpdatePresentation): boolean {
  return (
    a.updatable === b.updatable &&
    a.busy === b.busy &&
    a.failed === b.failed &&
    a.actionLabel === b.actionLabel &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.progress === b.progress
  );
}

/** The notification open for one key, and the three things about it that still move. */
interface LiveUpdateToast {
  present: (presentation: LiveUpdatePresentation) => void;
  setAct: (act: () => void) => void;
  setOffer: (version: string | null) => void;
}

export interface LiveUpdateToastOptions<Key extends string> {
  toastId: (key: Key) => string;
  /** The mark in the slot a toast keeps for a status glyph. */
  icon: (key: Key) => JSX.Element;
  /** The provider whose colour the bar takes, or nothing for the default fill. */
  barProvider?: (key: Key) => string | undefined;
}

export interface LiveUpdateToasts<Key extends string> {
  /** Open an offer or an explicitly started update, or move the open one to this state. */
  show: (key: Key, presentation: LiveUpdatePresentation, act: () => void, offer: string | null) => void;
  /**
   * Move the open notification to this state. It does nothing when no notification is open, so
   * reports alone never reopen a closed toast. A settled state counts itself out.
   */
  report: (
    key: Key,
    presentation: LiveUpdatePresentation,
    act: () => void,
    offer: string | null,
    settled: boolean,
  ) => void;
  /** The offer this key's notification was closed on by the user, and so must not be raised again. */
  offerClosed: (key: Key, version: string | null) => boolean;
  /** Take the notification off the screen without ending the offer behind it. */
  hide: (key: Key) => void;
  /** End the offer as well as the notification: it has been acted on, cancelled or settled. */
  dismiss: (key: Key) => void;
}

/** One family of update notifications, one per key, and the state each one keeps. */
export function createLiveUpdateToasts<Key extends string>(
  options: LiveUpdateToastOptions<Key>,
): LiveUpdateToasts<Key> {
  const liveToasts = new Map<Key, LiveUpdateToast>();
  const dismissTimers = new Map<Key, number>();
  const disposers = new Map<Key, () => void>();
  /**
   * The version each notification was closed on by the user.
   *
   * It lives here because this module outlives the stores that raise the notification, which can
   * be rebuilt, for example for every server the user opens: without it, coming back raises an
   * offer the user has already closed. It is keyed by version, so the next version is a new offer
   * and is announced.
   */
  const closedOffers = new Map<Key, string>();

  function clearDismissTimer(key: Key): void {
    const timer = dismissTimers.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    dismissTimers.delete(key);
  }

  /**
   * Forget the notification, whether it was dismissed from here or closed by the user.
   *
   * Sonner calls this back for both, so the reactive root that owns the detail and the button is
   * disposed exactly once, and the next update opens a new notification instead of writing into one
   * that has left the screen.
   */
  function release(key: Key): void {
    clearDismissTimer(key);
    liveToasts.delete(key);
    disposers.get(key)?.();
    disposers.delete(key);
  }

  /**
   * Open the notification, or hand back the one already open.
   *
   * The root is explicit because the caller is an effect over a status snapshot: owned by it, these
   * elements would be disposed by the next snapshot that arrives.
   *
   * The root builds the parts and nothing else. Raising the toast is a write to the Toaster's store,
   * and Solid allows a write from an effect - the node carries `CONFIG_CHILDREN_FORBIDDEN`, which is
   * what marks the sanctioned place for a side effect - but not from a plain owner such as this root.
   * Calling `toast()` inside it throws `REACTIVE_WRITE_IN_OWNED_SCOPE` and halts the reactive system
   * for the whole page. It is a write the second notification makes and the first does not: the store
   * only notifies the properties something has already read, and on an empty Toaster there are none
   * yet. So the parts are built here and handed back, and the caller raises the notification.
   */
  function liveToast(key: Key, presentation: LiveUpdatePresentation): LiveUpdateToast {
    const open = liveToasts.get(key);
    if (open) return open;

    const parts = createRoot((dispose) => {
      // Main pushes one snapshot for every percent of every download. A presentation that says what
      // is on screen already changes nothing.
      const [current, setCurrent] = createSignal(presentation, { equals: samePresentation });
      // What changes the height of the toast: the lines it shows, not the percentage on one of them.
      // A step with no measurable end keeps the title of the download before it and loses the
      // percentage, so the words of the title alone are not enough.
      const layout = createMemo(() => {
        const { title, detail, busy, failed, progress, actionLabel } = current();
        return JSON.stringify([title, detail, busy, failed, progress === null, actionLabel ?? null]);
      });
      // Whether the failure's sentence is cut off, and whether the user opened it. Both change the
      // height of the toast, so they live here, where the title can read them.
      const [clamped, setClamped] = createSignal(false);
      const [expanded, setExpanded] = createSignal(false);
      // Read at click time, so the button that offered the update is the button that retries it.
      let act = (): void => {};
      let offered: string | null = null;

      const live: LiveUpdateToast = {
        present: (next) => {
          const previous = untrack(current);
          setCurrent(next);
          // A retry closes the old failure, so the next one opens at its first lines. A retry that
          // fails before it starts goes from one failure to the next, so new words close it too.
          if (!next.failed || next.detail !== previous.detail) setExpanded(false);
        },
        setAct: (next) => {
          act = next;
        },
        setOffer: (version) => {
          offered = version;
        },
      };
      liveToasts.set(key, live);
      disposers.set(key, dispose);

      return {
        live,
        offeredVersion: () => offered,
        // The title is the one thing given as a function. Sonner re-measures the toast whenever the
        // title or the description changes, and the other two are elements that keep their identity
        // for the whole flow, so these reads are what keep the recorded height honest. Opening or
        // cutting off the failure's sentence changes the height without changing the title's words,
        // so the title reads those two as well.
        //
        // It does not read the percentage. A measurement sets the toast's height to `auto` for a
        // moment, which stops the height transition of the stack, and a download measured on every
        // percent made concurrent updates jump and spend the CPU on layout.
        title: () => {
          clamped();
          expanded();
          layout();
          return untrack(current).title;
        },
        icon: options.icon(key),
        description: (
          <LiveUpdateDetail
            barProvider={options.barProvider?.(key)}
            presentation={current()}
            expanded={expanded()}
            clamped={clamped()}
            onExpandedChange={setExpanded}
            onClampedChange={setClamped}
          />
        ),
        label: <LiveUpdateActionLabel presentation={current()} />,
        // Sonner deletes a toast after its action unless the click is defaultPrevented. Staying is
        // what lets one notification carry the offer, the download and the outcome.
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          act();
        },
      };
    });

    toast(parts.title, {
      id: options.toastId(key),
      class: "provider-update-toast",
      icon: parts.icon,
      description: parts.description,
      action: { label: parts.label, onClick: parts.onClick },
      duration: PERSISTENT,
      onDismiss: () => {
        // Only the user reaches this notification while it is still the live one: every close made
        // from this module releases it first, so a late callback for one of those finds nothing.
        if (liveToasts.get(key) !== parts.live) return;
        const closed = parts.offeredVersion();
        if (closed) closedOffers.set(key, closed);
        release(key);
      },
    });

    return parts.live;
  }

  function hide(key: Key): void {
    toast.dismiss(options.toastId(key));
    release(key);
  }

  function dismiss(key: Key): void {
    closedOffers.delete(key);
    hide(key);
  }

  return {
    show: (key, presentation, act, offer) => {
      clearDismissTimer(key);
      const live = liveToast(key, presentation);
      live.present(presentation);
      live.setAct(act);
      live.setOffer(offer);
    },
    report: (key, presentation, act, offer, settled) => {
      const live = liveToasts.get(key);
      if (!live) return;
      live.present(presentation);
      live.setAct(act);
      live.setOffer(offer);

      clearDismissTimer(key);
      if (!settled) return;
      // Sonner's own timer never started, and cannot be started now without replacing the
      // notification, so a settled notification counts itself out here.
      dismissTimers.set(
        key,
        window.setTimeout(() => dismiss(key), TOAST_DURATION),
      );
    },
    offerClosed: (key, version) => version !== null && closedOffers.get(key) === version,
    hide,
    dismiss,
  };
}
