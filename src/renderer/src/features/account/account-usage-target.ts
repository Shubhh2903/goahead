import { createMemo } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";

/**
 * Which account usage reading is current, and whether a provider can answer for it yet. The dock
 * and the usage report read the same reading, so they share the key.
 */
export function useAccountUsageTarget() {
  const { agentStatus } = useAgents();
  const { activeServerId } = useServers();
  const ready = createMemo(() => {
    const status = agentStatus();
    return (
      status.phase === "ready" ||
      Boolean(status.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting"))
    );
  });
  const targetKey = createMemo(() => {
    const serverId = activeServerId();
    if (!serverId) return null;
    const connected = (agentStatus().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${serverId}:${connected}`;
  });
  return { ready, targetKey };
}
