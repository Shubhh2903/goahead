import type { Effect } from "effect";
import type { ThreadItem } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";

export interface ProviderHistoryFragment {
  turnId: string;
  status?: string;
  startedAt?: number;
  itemOffset?: number;
  items: ThreadItem[];
  liveTurnId?: string;
  recordsOnly?: boolean;
  complete: boolean;
}

export interface ProviderHistoryRequest {
  threadId: string;
  cwd?: string;
  items: "none" | "full";
  providerOnly?: boolean;
  resumeKey?: string;
}

export type ProviderHistoryConsumer = (
  fragment: ProviderHistoryFragment,
) => Effect.Effect<boolean, ProviderClientOperationError>;

export type ReadProviderHistory = (
  request: ProviderHistoryRequest,
  consume: ProviderHistoryConsumer,
) => Effect.Effect<void, ProviderClientOperationError>;

export const PROVIDER_HISTORY_PAGE_SIZE = 50;

/** One turn of the released full-history `thread/read` response. */
export interface CollectedHistoryTurn {
  id: string;
  status?: string;
  startedAt?: number;
  items: ThreadItem[];
}

/**
 * Adds one fragment to the turns of a released `thread/read` response. That response is a full
 * snapshot by contract, so only that endpoint builds it, and only for the response.
 */
export function collectHistoryTurn(
  turns: Map<string, CollectedHistoryTurn>,
  seenItems: Map<string, Set<string>>,
  fragment: ProviderHistoryFragment,
): void {
  let turn = turns.get(fragment.turnId);
  if (!turn) {
    turn = { id: fragment.turnId, items: [] };
    turns.set(fragment.turnId, turn);
  }
  if (fragment.status !== undefined) turn.status = fragment.status;
  if (fragment.startedAt !== undefined) turn.startedAt = fragment.startedAt;
  const ids = seenItems.get(fragment.turnId) ?? new Set<string>();
  for (const item of fragment.items) {
    if (item.id && ids.has(item.id)) continue;
    if (item.id) ids.add(item.id);
    turn.items.push(item);
  }
  seenItems.set(fragment.turnId, ids);
}
