/**
 * Where a running auto-reply turn runs. `pending` from the moment the turn holds its conversation
 * until GoAhead knows the thread: no send and no turn event is the turn's then. `context` is the
 * reply context of the conversation. `main` is the orchestrator's main thread, only when the reply
 * context belongs to another agent that is busy.
 */
export type AutoReplyRoute =
  | { kind: "pending" }
  | { kind: "context"; threadId: string }
  | { kind: "main"; threadId: string };

/** True when a send or a turn event from `threadId` belongs to the auto-reply turn on this route. */
export function autoReplyRouteAccepts(route: AutoReplyRoute, threadId: string): boolean {
  return route.kind !== "pending" && route.threadId === threadId;
}
