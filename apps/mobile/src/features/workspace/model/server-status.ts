import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { RemoteTeamHost } from "@openbot/team-client";
import { type RemoteRecoveryStatus, remoteRecoveryMessage } from "@openbot/team-client";
import { serverAccent } from "./server-order";
import type { MobileServer, MobileServerState } from "./workspace-types";

const LABELS = {
  unknown: "mobile.workspace.status.notConnected",
  connecting: "common.connecting",
  online: "mobile.workspace.status.online",
  offline: "mobile.workspace.status.offline",
  error: "mobile.workspace.status.error",
} as const satisfies Record<MobileServerState, MobileTextKey>;

export function serverStatusLabel(
  server: Pick<MobileServer, "state" | "initialConnectionPending">,
  t: MobileTranslate,
): string {
  if (server.state === "connecting" && !server.initialConnectionPending) return t(LABELS.offline);
  return t(LABELS[server.state]);
}

export function applyServerFailure(server: MobileServer, connectionMessage: string | null): MobileServer {
  // Suspending RTC also rejects in-flight loads; their failure must not replace the protocol error.
  if (server.recoveryStatus?.phase === "suspended") return server;
  return { ...server, state: "offline", initialConnectionPending: false, connectionMessage };
}

export function applyServerRecovery(
  server: MobileServer,
  status: RemoteRecoveryStatus,
  failure: string | null,
): MobileServer {
  const state: MobileServerState =
    status.phase === "online"
      ? "online"
      : status.phase === "connecting"
        ? "connecting"
        : status.phase === "suspended"
          ? "error"
          : "offline";
  return {
    ...server,
    state,
    connectionMessage: remoteRecoveryMessage(status, failure),
    recoveryStatus: status,
    initialConnectionPending: server.initialConnectionPending && state === "connecting",
  };
}

export function serverKind(hostId: string, pairedHostId: string | undefined): MobileServer["kind"] {
  return hostId === pairedHostId ? "local" : "remote";
}

/**
 * The row for a host in the account directory. A refresh of the directory keeps what the
 * connection already knows about the server: its state, recovery status and connection path.
 */
export function serverFromHost(
  host: RemoteTeamHost,
  previous: MobileServer | undefined,
  kind: MobileServer["kind"],
): MobileServer {
  return {
    id: host.hostId,
    name: host.name,
    logoKey: host.logoKey,
    kind,
    state: previous?.state ?? "unknown",
    initialConnectionPending: previous?.initialConnectionPending ?? true,
    connectionMessage: previous?.connectionMessage ?? null,
    recoveryStatus: previous?.recoveryStatus,
    connectionPath: previous?.connectionPath,
    address: null,
    accent: serverAccent(host.hostId),
    publicKey: previous?.publicKey ?? host.devicePublicKey,
    membershipId: host.membershipId,
    role: host.role,
    ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
  };
}
