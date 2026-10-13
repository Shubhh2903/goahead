import { PRODUCT_IDENTITY } from "@openbot/contracts/product-identity";
import { WhatsNewDialog } from "@openbot/ui/features/updates/WhatsNewDialog";
import { createEffect, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { useWhatsNew } from "./whats-new-context";

/** GoAhead's public changelog page. It shows the same `CHANGELOG.md` that the dialog reads. */
const WHATS_NEW_CHANGELOG_URL = `${PRODUCT_IDENTITY.siteOrigin}/changelog`;

/** Mounted only when the workspace is ready, outside the lifetime of a selected server. */
export function WhatsNewOverlay(props: { ready: boolean }) {
  const whatsNew = useWhatsNew();
  createEffect(
    () => props.ready && whatsNew.state.version !== "",
    (ready) => {
      if (ready) untrack(whatsNew.start);
    },
  );
  return (
    <WhatsNewDialog
      open={props.ready && whatsNew.state.open}
      version={whatsNew.state.version}
      previousVersion={whatsNew.state.previousVersion}
      notes={whatsNew.state.notes}
      onOpenChange={(open) => {
        if (!open) whatsNew.close();
      }}
      onRetry={whatsNew.retry}
      onOpenChangelog={() => {
        void appPort()
          .openUrl(WHATS_NEW_CHANGELOG_URL)
          .catch(() => undefined);
      }}
    />
  );
}
