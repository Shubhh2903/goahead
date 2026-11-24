import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { ConnectionFailureReason } from "@openbot/team-client";
import type { MobileServer } from "./workspace-types";

const REASONS = {
  "signal-unreachable": "mobile.workspace.connectionPath.reason.signalUnreachable",
  "no-answer": "mobile.workspace.connectionPath.reason.noAnswer",
  "no-stun": "mobile.workspace.connectionPath.reason.noStun",
  "stun-unreachable": "mobile.workspace.connectionPath.reason.stunUnreachable",
  "no-relay": "mobile.workspace.connectionPath.reason.noRelay",
  "no-path": "mobile.workspace.connectionPath.reason.noPath",
} as const satisfies Record<ConnectionFailureReason, MobileTextKey>;

/**
 * "Direct" or "Relay" while the server is online, "Cannot connect: <reason>" while it is offline,
 * and null otherwise. A path from an earlier attempt never shows on a state it does not describe.
 */
export function connectionPathLabel(
  server: Pick<MobileServer, "state" | "connectionPath">,
  t: MobileTranslate,
): string | null {
  const path = server.connectionPath;
  if (!path) return null;
  if (path.kind === "cannot-connect") {
    if (server.state !== "offline") return null;
    return t("mobile.workspace.connectionPath.cannotConnect", { reason: t(REASONS[path.reason]) });
  }
  if (server.state !== "online") return null;
  return t(path.kind === "direct" ? "mobile.workspace.connectionPath.direct" : "mobile.workspace.connectionPath.relay");
}
