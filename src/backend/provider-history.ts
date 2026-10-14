import type { ThreadItem } from "./protocol";

/** A fragment is never a complete conversation or a replacement snapshot. */
export interface ProviderHistoryFragment {
  turnId: string;
  status?: string;
  startedAt?: number;
  /** Stable offset within the turn. This is not a provider cursor. */
  itemOffset?: number;
  items: ThreadItem[];
  /** The provider has no stable OpenBot turn identity; retain this record for reads and recovery only. */
  recordsOnly?: boolean;
  /** The last fragment of this turn in this scan. */
  complete: boolean;
}

export interface ProviderHistoryRequest {
  threadId: string;
  cwd?: string;
  /** Metadata reads omit items, for recovery of a known turn. */
  items: "none" | "full";
  /** Import recovery from the provider; do not satisfy this read from the durable staging seam. */
  providerOnly?: boolean;
}

/** Resolve false to stop the scan after this fragment. Cursors stay inside the adapter. */
export type ProviderHistoryConsumer = (fragment: ProviderHistoryFragment) => Promise<boolean>;

/**
 * Reads provider history newest turn first, one bounded fragment at a time. It rejects with the
 * provider's error. A reader never retains the full transcript.
 */
export type ReadProviderHistory = (request: ProviderHistoryRequest, consume: ProviderHistoryConsumer) => Promise<void>;

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
