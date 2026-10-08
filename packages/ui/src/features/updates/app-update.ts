import type { UpdateStatus } from "@openbot/contracts/ipc";
import { PRODUCT_IDENTITY } from "@openbot/contracts/product-identity";
import { currentText, type TextValue } from "../../text";
import type { ProviderUpdatePresentation } from "../provider-updates/provider-update";

/** The update notification of GoAhead itself has the same shape as a provider CLI's. */
export type AppUpdatePresentation = ProviderUpdatePresentation;

/**
 * What the update notification of GoAhead shows for one updater status, or `null` when it shows
 * nothing.
 *
 * It shows the offer, the download, the downloaded update and a failed download. A failed check
 * shows nothing: a feed that the app cannot read fails every check, and Settings already says so. A
 * host that manages the updates of this computer, and a restart that already waits with its own
 * notification, show nothing here either.
 */
export function presentAppUpdate(
  status: UpdateStatus,
  text: Pick<TextValue, "t" | "errorMessage"> = currentText(),
): AppUpdatePresentation | null {
  if (status.managedByHost === true || status.scheduledRestart || status.idleRestart) return null;
  const { t } = text;
  const name = PRODUCT_IDENTITY.name;
  const versions = `${formatVersion(status.currentVersion, text)} → ${formatVersion(status.availableVersion, text)}`;
  const base = { updatable: false, busy: false, failed: false, progress: null, detail: versions };

  switch (status.phase) {
    case "available":
      return {
        ...base,
        updatable: true,
        actionLabel: t("update.provider.update"),
        title: t("update.provider.available", { name }),
      };
    case "downloading":
      return {
        ...base,
        busy: true,
        actionLabel: undefined,
        title: t("update.provider.updating", { name }),
        progress: status.progress === null ? null : Math.round(Math.max(0, Math.min(100, status.progress))),
      };
    case "ready":
      return { ...base, actionLabel: t("update.app.restart"), title: t("update.app.ready", { name }) };
    case "error":
      if (status.errorCode !== "download_failed") return null;
      return {
        ...base,
        failed: true,
        actionLabel: t("common.retry"),
        title: t("update.provider.failed", { name }),
        detail: text.errorMessage(status.message, t("update.provider.interrupted")),
      };
    default:
      return null;
  }
}

function formatVersion(version: string | null, text: Pick<TextValue, "t">): string {
  if (!version) return text.t("update.provider.unknownVersion");
  return version.startsWith("v") ? version : `v${version}`;
}
