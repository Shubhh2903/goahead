import { ProviderLogo } from "@openbot/brand";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { type ProviderUpdate, presentProviderUpdate } from "@openbot/ui/features/provider-updates/provider-update";
import type { JSX } from "@solidjs/web";
import { createLiveUpdateToasts } from "../updates/live-update-toast";

/**
 * The provider update, as one notification the user acts on and then watches. The notification
 * itself is `live-update-toast.tsx`, which the update of GoAhead uses too; this module says which
 * provider it is for and what each runtime state shows.
 */

/**
 * The provider mark stands in the slot a toast keeps for a status glyph: with three providers able
 * to offer an update, which one this is reads before the outcome does. Nothing here uses
 * `toast.success` or `toast.error`, whose only effect is to tint the icon this mark has replaced.
 */
function providerIcon(provider: AgentProviderId): JSX.Element {
  return <ProviderLogo provider={provider} class="provider-update-toast-logo" />;
}

const providerToasts = createLiveUpdateToasts<AgentProviderId>({
  toastId: (provider) => `provider-update-${provider}`,
  icon: providerIcon,
  // The bar carries the provider's colour, the same one the mark beside it carries.
  barProvider: (provider) => provider,
});

/** Open an offer or an explicitly started update. Reports alone never reopen a closed toast. */
export function showProviderUpdateToast(update: ProviderUpdate, onUpdate: () => void): void {
  const presentation = presentProviderUpdate(update);
  providerToasts.show(update.provider, presentation, onUpdate, presentation.updatable ? update.availableVersion : null);
}

/** The offer this provider's notification was closed on, and so must not be raised again. */
export function providerUpdateOfferClosed(provider: AgentProviderId, availableVersion: string | null): boolean {
  return providerToasts.offerClosed(provider, availableVersion);
}

/**
 * Take the notification off the screen without ending the offer behind it.
 *
 * A server switch rebuilds the runtime store, and what the user was told about this computer is not
 * the switch's to forget: the offer is raised again on the way back, unless the user closed it.
 */
export function hideProviderUpdateToast(provider: AgentProviderId): void {
  providerToasts.hide(provider);
}

/**
 * Move the same notification through the update: the percentage, then the outcome. A failure offers
 * Retry, because an update a user can start and not reattempt is the dead end this feature exists to
 * remove. A finished update has nothing left to offer, so it counts itself out instead.
 */
export function reportProviderUpdateToast(update: ProviderUpdate, onRetry: () => void): void {
  const presentation = presentProviderUpdate(update);
  providerToasts.report(
    update.provider,
    presentation,
    onRetry,
    presentation.updatable ? update.availableVersion : null,
    !presentation.busy && !presentation.failed,
  );
}

/** End the offer as well as the notification: it has been acted on, cancelled or settled. */
export function dismissProviderUpdateToast(provider: AgentProviderId): void {
  providerToasts.dismiss(provider);
}
