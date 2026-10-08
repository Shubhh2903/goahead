import { AppLogo } from "@openbot/brand";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { presentAppUpdate } from "@openbot/ui/features/updates/app-update";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";
import { createLiveUpdateToasts } from "./live-update-toast";

const APP_KEY = "app";

/** The update of GoAhead itself, in the same notification the provider CLI updates use. */
const appToasts = createLiveUpdateToasts<typeof APP_KEY>({
  toastId: () => "app-update",
  icon: () => <AppLogo variant="production" class="app-update-toast-logo" />,
});

/**
 * Raises the offer of a new GoAhead version and follows it through the download to the restart.
 * `act` is the Settings update action: it downloads an offered or failed update, and installs a
 * downloaded one. The user's close hides the offer for that version only.
 */
export function createAppUpdateToast(options: { status: Accessor<UpdateStatus>; act: () => Promise<void> }): void {
  function act(): void {
    options.act().catch((error: unknown) => {
      const text = currentText();
      actionToast.error(text.errorMessage(error, text.t("settings.updates.actionFailed")));
    });
  }

  createEffect(
    () => {
      const status = options.status();
      // A check, also the periodic one, keeps what is on screen, so an offer does not close and
      // open again every few minutes.
      if (status.phase === "checking") return undefined;
      return { presentation: presentAppUpdate(status), version: status.availableVersion };
    },
    (view) => {
      if (!view) return;
      if (!view.presentation) {
        appToasts.hide(APP_KEY);
        return;
      }
      if (appToasts.offerClosed(APP_KEY, view.version)) return;
      appToasts.show(APP_KEY, view.presentation, act, view.version);
    },
  );
  onCleanup(() => appToasts.hide(APP_KEY));
}

/** Forget the notification and the version the user closed. Tests and stories start clean with it. */
export function dismissAppUpdateToast(): void {
  appToasts.dismiss(APP_KEY);
}
