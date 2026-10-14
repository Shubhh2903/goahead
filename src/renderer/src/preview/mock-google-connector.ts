import {
  DISCONNECTED_GOOGLE_CONNECTOR,
  type GoogleConnectorDesktopApi,
  type GoogleConnectorStatus,
} from "@openbot/contracts/ipc";

/** How long the mock waits for the person on Google's consent page. */
const MOCK_SIGN_IN_MS = 3_000;

const DISCONNECTED: GoogleConnectorStatus = { ...DISCONNECTED_GOOGLE_CONNECTOR, available: true };

/** Starts disconnected. Connect shows the wait for the browser, and after a few seconds the preview is signed in. */
export function createMockGoogleConnector(): GoogleConnectorDesktopApi {
  let status = DISCONNECTED;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(status: GoogleConnectorStatus) => void>();
  const set = (next: GoogleConnectorStatus): GoogleConnectorStatus => {
    status = next;
    for (const listener of listeners) listener({ ...status });
    return { ...status };
  };
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    status: async () => ({ ...status }),
    connect: async () => {
      stopTimer();
      const mailAgentId = status.mailAgentId;
      timer = setTimeout(() => {
        timer = null;
        set({ ...DISCONNECTED, state: "connected", email: "preview@example.com", mailAgentId: status.mailAgentId });
      }, MOCK_SIGN_IN_MS);
      return set({ ...DISCONNECTED, state: "pending", mailAgentId });
    },
    cancel: async () => {
      stopTimer();
      return set({ ...DISCONNECTED, mailAgentId: status.mailAgentId });
    },
    disconnect: async () => {
      stopTimer();
      return set({ ...DISCONNECTED, mailAgentId: status.mailAgentId });
    },
    setMailAgent: async (agentId) => set({ ...status, mailAgentId: agentId }),
    notices: async () => [],
    onNoticesChanged: () => () => undefined,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
