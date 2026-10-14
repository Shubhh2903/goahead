import type { DatabaseSync } from "node:sqlite";
import type { AgentProviderId, ConversationMessage } from "@openbot/contracts/ipc";
import { mergeProviderHistoryMessages, messagesFromThreadItems, threadTurnBaseTime } from "./conversation-snapshots";
import { databaseRow, decodeConversationMessageJson, requiredStringColumn } from "./database/database-rows";
import type { DeliveryContext } from "./mailbox-store";
import type { ThreadItem } from "./protocol";
import type {
  ProviderHistoryConsumer,
  ProviderHistoryFragment,
  ProviderHistoryRequest,
  ReadProviderHistory,
} from "./provider-history";

/** The synchronous database boundary needed by the bounded provider-history importer. */
export interface ProviderHistoryImportDatabase {
  readonly connection: DatabaseSync;
  ensureProviderHistoryImport(input: {
    sessionId: string;
    threadId: string;
    provider: AgentProviderId;
    externalSessionId: string;
  }): unknown;
  stageProviderHistoryFragment(input: { sessionId: string; fragment: ProviderHistoryFragment }): unknown;
  stagedProviderHistoryItems(input: {
    sessionId: string;
    turnId: string;
    afterIndex?: number;
    limit?: number;
  }): Array<{ itemIndex: number; item: ThreadItem }>;
  markProviderHistoryImportState(sessionId: string, state: "pending" | "active" | "complete" | "failed"): void;
  importProviderHistoryMessages(input: {
    sessionId: string;
    turnId: string;
    agentId: string;
    threadId: string;
    messages: readonly ConversationMessage[];
    /** Highest staged item included in this normalized page. */
    throughItemIndex?: number;
    complete: boolean;
    detail?: unknown;
  }): void;
}

export interface ProviderHistoryImportInput {
  database: ProviderHistoryImportDatabase;
  readHistory: ReadProviderHistory;
  sessionId: string;
  provider: AgentProviderId;
  externalSessionId: string;
  agentId: string;
  publicThreadId: string;
  cwd?: string;
  findDelivery(deliveryId: string): DeliveryContext | null;
}

export interface ProviderHistoryImportResult {
  turns: number;
  messages: number;
}

/** The number of staged items one normalized page reads. */
const IMPORT_PAGE_ITEMS = 50;

/**
 * Imports provider history as a stream of completed turns.
 *
 * The provider adapter owns its cursors. This layer keeps only incomplete turns in the durable
 * staging tables, then reads one bounded item page at a time and writes that page in one
 * transaction. It never writes a full conversation snapshot and never deletes a message missing
 * from a page. A failed read marks the import `failed` and rejects with the provider's error.
 */
export async function importProviderHistory(input: ProviderHistoryImportInput): Promise<ProviderHistoryImportResult> {
  input.database.ensureProviderHistoryImport({
    sessionId: input.sessionId,
    threadId: input.publicThreadId,
    provider: input.provider,
    externalSessionId: input.externalSessionId,
  });
  let turns = 0;
  let messages = 0;
  let providerCovered = false;
  const consume: ProviderHistoryConsumer = async (fragment) => {
    input.database.stageProviderHistoryFragment({ sessionId: input.sessionId, fragment });
    if (!fragment.complete) return true;
    providerCovered = true;
    // ACP replay has stable item IDs only inside the provider transcript. It has no stable
    // OpenBot turn ID, so normalizing it into the conversation projection would duplicate a
    // live turn after release and reload. Keep the bounded raw records for handoff and reads;
    // live OpenBot turns already committed their normalized messages under durable IDs.
    if (fragment.recordsOnly) {
      input.database.importProviderHistoryMessages({
        sessionId: input.sessionId,
        turnId: fragment.turnId,
        agentId: input.agentId,
        threadId: input.publicThreadId,
        messages: [],
        complete: true,
        detail: {
          provider: input.provider,
          externalSessionId: input.externalSessionId,
          turnId: fragment.turnId,
          recordsOnly: true,
        },
      });
      turns += 1;
      return true;
    }
    messages += await importCompletedTurn(input, fragment);
    turns += 1;
    return true;
  };

  try {
    await input.readHistory(
      {
        threadId: input.externalSessionId,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        items: "full",
        providerOnly: true,
      } satisfies ProviderHistoryRequest,
      consume,
    );
  } catch (error) {
    input.database.markProviderHistoryImportState(input.sessionId, "failed");
    throw error;
  }
  if (providerCovered) input.database.markProviderHistoryImportState(input.sessionId, "complete");
  return { turns, messages };
}

async function importCompletedTurn(
  input: ProviderHistoryImportInput,
  fragment: ProviderHistoryFragment,
): Promise<number> {
  let importedCount = 0;
  let afterIndex = -1;
  let complete = false;
  let baseTime: number | undefined;
  while (!complete) {
    const page = input.database.stagedProviderHistoryItems({
      sessionId: input.sessionId,
      turnId: fragment.turnId,
      afterIndex,
      limit: IMPORT_PAGE_ITEMS,
    });
    const last = page.at(-1);
    complete = page.length < IMPORT_PAGE_ITEMS;
    if (page.length > 0 && (!last || last.itemIndex <= afterIndex)) {
      throw new Error("Provider history staging returned a repeated item index.");
    }
    const turn = {
      id: fragment.turnId,
      ...(fragment.status === undefined ? {} : { status: fragment.status }),
      ...(fragment.startedAt === undefined ? {} : { startedAt: fragment.startedAt }),
    };
    const items = page.map(({ item }) => item);
    baseTime ??= threadTurnBaseTime(turn, items, input.findDelivery);
    const pageMessages = messagesFromThreadItems(
      { ...turn, baseTime },
      items,
      page[0]?.itemIndex ?? afterIndex + 1,
      input.findDelivery,
    );
    const reconciled =
      input.provider === "claude"
        ? mergeProviderHistoryMessages(
            // Claude can use a new provider ID for a reply that OpenBot already published under the
            // live turn ID. Read only matching IDs from SQLite, so reconciliation never materializes
            // the full chat or the full turn.
            readStoredTurnMessages(input.database, input.publicThreadId, fragment.turnId, pageMessages),
            pageMessages,
            input.provider,
          )
        : [...pageMessages];
    input.database.importProviderHistoryMessages({
      sessionId: input.sessionId,
      turnId: fragment.turnId,
      agentId: input.agentId,
      threadId: input.publicThreadId,
      messages: reconciled,
      ...(last === undefined ? {} : { throughItemIndex: last.itemIndex }),
      complete,
      detail: {
        provider: input.provider,
        externalSessionId: input.externalSessionId,
        turnId: fragment.turnId,
      },
    });
    importedCount += reconciled.length;
    if (last) afterIndex = last.itemIndex;
    if (page.length === 0) complete = true;
    // One page at a time: let other work run between the synchronous page writes.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return importedCount;
}

function readStoredTurnMessages(
  database: ProviderHistoryImportDatabase,
  threadId: string,
  turnId: string,
  imported: readonly ConversationMessage[],
): ConversationMessage[] {
  /*
   * Claude's live stream publishes narration with IDs that differ from the IDs in its transcript.
   * Read one identity separately so reconciliation can see that the turn already has narration.
   * The query returns one ID only; message JSON is fetched only for this turn's candidate IDs
   * below. Do not query all rows for a turn: a long tool-heavy turn is still a bounded import page,
   * while the projection may contain many old records.
   */
  const identityRows = database.connection
    .prepare(
      `SELECT message_id FROM projection_thread_messages
       WHERE thread_id = ? AND turn_id = ?
         AND substr(message_id, 1, ?) = ?
       LIMIT 1`,
    )
    .all(threadId, turnId, `${turnId}:narration:`.length, `${turnId}:narration:`);
  const identityIds = identityRows.flatMap((row) => {
    const value = databaseRow(row);
    if (!value) return [];
    return [requiredStringColumn(value, "message_id")];
  });
  const ids = [
    ...new Set([
      `${turnId}:assistant`,
      // Live Claude collapses all thinking for a turn under this canonical identity. Provider
      // transcript reasoning keeps its own IDs, so this row is the duplicate check only.
      `${turnId}:reasoning`,
      ...identityIds,
      ...imported.flatMap((message) => (message.id ? [message.id] : [])),
    ]),
  ];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database.connection
    .prepare(
      `SELECT message_json FROM projection_thread_messages
       WHERE thread_id = ? AND message_id IN (${placeholders})`,
    )
    .all(threadId, ...ids);
  const messages = new Map<string, ConversationMessage>();
  for (const row of rows) {
    const message = decodeStoredMessageRow(row);
    if (message) messages.set(message.id, message);
  }
  return [...messages.values()];
}

function decodeStoredMessageRow(row: unknown): ConversationMessage | null {
  const value = databaseRow(row);
  if (!value) return null;
  try {
    return decodeConversationMessageJson(requiredStringColumn(value, "message_json"));
  } catch {
    return null;
  }
}
