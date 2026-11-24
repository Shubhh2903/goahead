// The Usage tab of this computer. It is local only: it reads this computer's database and has no Team
// API route, so a joined server's usage stays in the host usage report.

import { parseUsageRange } from "@openbot/contracts/ipc";
import type { AgentService } from "../../backend/agent-service";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface UsageIpcDependencies {
  service: Pick<AgentService, "getUsageDashboard">;
}

export function usageIpcHandlers({ service }: UsageIpcDependencies): Pick<IpcGroupHandlers, "usage"> {
  return {
    usage: {
      getDashboard: payloadHandler(parseUsageRange, (range) => service.getUsageDashboard(range)),
    },
  };
}
