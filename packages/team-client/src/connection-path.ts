/** How a phone reaches a desktop, from the ICE candidate pair the browser selected. */
export type ConnectionFailureReason =
  | "signal-unreachable"
  | "no-answer"
  | "no-stun"
  | "stun-unreachable"
  | "no-relay"
  | "no-path";

export type ConnectionPath =
  | { kind: "direct" }
  | { kind: "relay" }
  | { kind: "cannot-connect"; reason: ConnectionFailureReason };

/**
 * Maps the candidate types of the selected pair. A relay on either side is a relay path; host,
 * server-reflexive and peer-reflexive on both sides is a direct path. A type this code does not
 * know gives `null`, so the UI shows nothing instead of a guess.
 */
export function connectionPathFromCandidates(
  local: string | undefined,
  remote: string | undefined,
): ConnectionPath | null {
  if (local === "relay" || remote === "relay") return { kind: "relay" };
  return isDirectType(local) && isDirectType(remote) ? { kind: "direct" } : null;
}

function isDirectType(type: string | undefined): boolean {
  return type === "host" || type === "srflx" || type === "prflx";
}

export interface ConnectionFailureFacts {
  /** Signal sent `ready` at least once on this peer. */
  signalWasReady: boolean;
  /** The `urls` of the ICE servers that Signal sent. */
  iceServerUrls: string[];
  /** The host's answer to the offer arrived, so the host was online and ICE could start. */
  hostAnswered: boolean;
  /** The phone gathered a server-reflexive candidate, so a STUN server answered. */
  gatheredServerReflexive: boolean;
  /** The browser reported an error for a STUN URL. Absence of a reflexive candidate is not proof. */
  stunCandidateError: boolean;
}

export function connectionFailureReason(facts: ConnectionFailureFacts): ConnectionFailureReason {
  if (!facts.signalWasReady) return "signal-unreachable";
  // No answer means the host may be asleep or offline. Say that, not that the network failed.
  if (!facts.hostAnswered) return "no-answer";
  const hasScheme = (scheme: "stun" | "turn") =>
    facts.iceServerUrls.some((url) => url.startsWith(`${scheme}:`) || url.startsWith(`${scheme}s:`));
  if (!hasScheme("stun")) return "no-stun";
  if (facts.stunCandidateError && !facts.gatheredServerReflexive) return "stun-unreachable";
  if (!hasScheme("turn")) return "no-relay";
  return "no-path";
}

/** The `urls` of each ICE server as one list. */
export function iceServerUrls(servers: readonly { urls: string | string[] }[]): string[] {
  return servers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
}
