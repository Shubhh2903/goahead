import { DISCONNECTED_GOOGLE_CONNECTOR, type GoogleConnectorStatus } from "@openbot/contracts/ipc";
import type { GoogleConnectorPanelProps } from "@openbot/ui/features/settings/GoogleConnectorPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import { type GoogleConnectorPort, googleConnectorPort } from "./google-connector-port";

export interface GoogleConnectorController {
  status: () => GoogleConnectorStatus;
  busy: () => boolean;
  /** Reads the status again, for a view that opens. */
  reload: () => void;
  connect: () => void;
  cancel: () => void;
  disconnect: () => void;
  setMailAgent: (agentId: string) => void;
}

/**
 * The Google connection of this computer. Reads the status once and then follows main's `changed`
 * event, because the sign-in finishes in the browser. Call it inside a component: the subscription
 * ends with that component. Cancel does not wait for another action.
 */
export function createGoogleConnector(
  port: () => GoogleConnectorPort = googleConnectorPort,
): GoogleConnectorController {
  const [status, setStatus] = createSignal<GoogleConnectorStatus>(DISCONNECTED_GOOGLE_CONNECTOR);
  const [busy, setBusy] = createSignal(false);
  let disposed = false;

  const unsubscribe = port().onChanged((next) => {
    if (!disposed) setStatus(next);
  });
  // A failed read keeps the last status. The next `reload` or `changed` event replaces it.
  const reload = () => {
    void port()
      .status()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch(() => undefined);
  };
  onSettled(reload);
  onCleanup(() => {
    disposed = true;
    unsubscribe();
  });

  const run = (action: () => Promise<GoogleConnectorStatus>, waits = true) => {
    if (waits && busy()) return;
    if (waits) setBusy(true);
    void action()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch((error: unknown) => {
        const { t, errorMessage } = currentText();
        actionToast.error(t("connector.google.actionFailed"), {
          description: errorMessage(error, t("connector.google.actionFailed")),
        });
      })
      .finally(() => {
        if (waits && !disposed) setBusy(false);
      });
  };

  return {
    status,
    busy,
    reload,
    connect: () => run(() => port().connect()),
    cancel: () => run(() => port().cancel(), false),
    disconnect: () => run(() => port().disconnect()),
    setMailAgent: (agentId) => run(() => port().setMailAgent(agentId)),
  };
}

/** The panel of the connector. `agents` are the agents of this computer. */
export function googlePanelProps(
  controller: GoogleConnectorController,
  agents: () => Array<{ id: string; name: string }>,
): GoogleConnectorPanelProps {
  return {
    get status() {
      return controller.status();
    },
    get busy() {
      return controller.busy();
    },
    get agents() {
      return agents();
    },
    onConnect: controller.connect,
    onCancel: controller.cancel,
    onDisconnect: controller.disconnect,
    onSelectMailAgent: controller.setMailAgent,
  };
}
