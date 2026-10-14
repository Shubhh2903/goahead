import type { AgentProvider } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { mergeConversationSnapshots } from "../conversation-snapshots";
import { LineTooLongError } from "../jsonl";
import type { MailboxStore } from "../mailbox-store";
import { importProviderHistory } from "../provider-history-import";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import { markIncompleteImageGeneration } from "./image-generation";
import type { MailboxSync } from "./mailbox-sync";
import type { ProviderRuntime } from "./provider-runtime";
import { providerForAgent } from "./thread-items";
import type { ThreadLifecycle } from "./thread-lifecycle";

export interface BootRecoveryHooks {
  executionThreads?(): Array<{ id: string; threadId: string }>;
  deliveryThreadId?(deliveryId: string): string | null;
  emitError(code: string, error: unknown, agentId?: string): void;
}

export interface BootRecoveryOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  providers: ProviderRuntime;
  conversation: ConversationRuntime;
  mailboxSync: MailboxSync;
  threads: ThreadLifecycle;
  hooks: BootRecoveryHooks;
}

/**
 * Restart recovery: settles what the previous process left mid-flight.
 *
 * - `recoverPersistedTurns` runs at startup before providers start: clears
 *   stale active turns, expires unanswered prompts, marks streaming messages
 *   interrupted.
 * - `reconcileUnresolvedDeliveries` runs once providers are ready: asks the
 *   provider what really happened to each orphaned delivery instead of
 *   assuming, and conservatively keeps `interrupted` on any doubt — never
 *   repeats uncertain side effects. A delivery is orphaned when the process
 *   that ran it is gone: the previous OpenBot run, or a provider CLI that
 *   exited. Any other unsettled delivery is a live turn of this run.
 * - `backfillProviderHistory` imports provider-side turns that happened while
 *   OpenBot was down into the persisted conversation, one bounded page at a time.
 *
 * Reads the store/mailbox/provider and writes the database plus in-memory
 * snapshots; delivery to the renderer goes through `mailboxSync` and
 * `emitError`. Never imports the facade.
 */
export class BootRecovery {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #providers: ProviderRuntime;
  readonly #conversation: ConversationRuntime;
  readonly #mailboxSync: MailboxSync;
  readonly #threads: ThreadLifecycle;
  readonly #hooks: BootRecoveryHooks;
  /**
   * Readiness also follows a provider restart, and startup readiness can come after the user's
   * first message has started on a provider that was ready sooner. Settling every unresolved
   * delivery then read a live turn as finished: its reply arrived in a chat that already showed
   * no active turn, and `markTerminal` cannot correct a terminal status.
   */
  readonly #orphanedDeliveryIds = new Set<string>();
  /** Do not read the same oversized history again after the provider restarts. */
  readonly #oversizedHistory = new Set<string>();

  constructor(options: BootRecoveryOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#providers = options.providers;
    this.#conversation = options.conversation;
    this.#mailboxSync = options.mailboxSync;
    this.#threads = options.threads;
    this.#hooks = options.hooks;
  }

  private threads() {
    const agents = this.#store.list();
    return [
      ...agents,
      ...(this.#hooks.executionThreads?.() ?? []).flatMap((context) => {
        const agent = agents.find((item) => item.id === context.id);
        if (!agent) return [];
        this.#conversation.registerExecutionThread(agent.id, context.threadId);
        return [{ ...agent, threadId: context.threadId }];
      }),
    ];
  }

  /**
   * The provider's shared CLI exited, so the deliveries it was running have no turn left to finish.
   * An agent that runs on a process of its own (`runsOnOwnProcess`) keeps its turn.
   */
  orphanDeliveriesOf(provider: AgentProvider, runsOnOwnProcess: (agentId: string) => boolean): void {
    const agents = this.#store.list();
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      const agent = agents.find((candidate) => candidate.id === delivery.recipientAgentId);
      if (agent && providerForAgent(agent) === provider && !runsOnOwnProcess(agent.id)) {
        this.#orphanedDeliveryIds.add(delivery.id);
      }
    }
  }

  /** Like `orphanDeliveriesOf`, for one agent whose own provider process exited. */
  orphanDeliveriesOfAgent(agentId: string): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) {
      if (delivery.recipientAgentId === agentId) this.#orphanedDeliveryIds.add(delivery.id);
    }
  }

  async reconcileUnresolvedDeliveries(): Promise<void> {
    const unresolved = this.#mailbox.unresolvedDeliveries();
    // A delivery settled by another path never becomes unresolved again, so its mark goes too.
    const unresolvedIds = new Set(unresolved.map(({ delivery }) => delivery.id));
    for (const id of this.#orphanedDeliveryIds) {
      if (!unresolvedIds.has(id)) this.#orphanedDeliveryIds.delete(id);
    }
    // An agent starts one turn at a time, so its unconfirmed deliveries are one batch. The turn names
    // only the first of them as its client id, and the others ran in that same turn.
    const unconfirmedStarts = new Map<string, Set<string>>();
    for (const { delivery } of unresolved) {
      if (delivery.status !== "starting" || delivery.turnId) continue;
      const ids = unconfirmedStarts.get(delivery.recipientAgentId) ?? new Set<string>();
      unconfirmedStarts.set(delivery.recipientAgentId, ids.add(delivery.id));
    }
    for (const context of unresolved) {
      const { delivery } = context;
      if (!this.#orphanedDeliveryIds.delete(delivery.id)) continue;
      let terminal: "completed" | "failed" | "interrupted" = "interrupted";
      let reason = "GoAhead restarted before this delivery reached a confirmed terminal state.";
      try {
        const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
        const client = agent ? this.#providers.clientForAgent(agent) : null;
        const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
        const session = agent && threadId ? this.#store.database.activeProviderSession(threadId, agent.provider) : null;
        const historyKey = session ? `${session.provider}:${session.externalSessionId}` : null;
        const readHistory = client?.readHistory;
        if (agent && session && historyKey && readHistory && !this.#oversizedHistory.has(historyKey)) {
          const batchIds = delivery.turnId ? null : unconfirmedStarts.get(delivery.recipientAgentId);
          let recovered: { id: string; status?: string } | undefined;
          try {
            // A known turn needs only the turn list; an unconfirmed start is found by its client id.
            await readHistory(
              {
                threadId: session.externalSessionId,
                cwd: agent.workspacePath,
                items: delivery.turnId ? "none" : "full",
              },
              async (fragment) => {
                const matches =
                  fragment.turnId === delivery.turnId ||
                  fragment.items.some(
                    (item) =>
                      item.type === "userMessage" &&
                      !!item.clientId &&
                      (item.clientId === delivery.id || batchIds?.has(item.clientId) === true),
                  );
                if (matches) {
                  recovered =
                    fragment.status === undefined
                      ? { id: fragment.turnId }
                      : { id: fragment.turnId, status: fragment.status };
                }
                return !matches;
              },
            );
          } catch (error) {
            if (containsLineTooLong(error)) this.#oversizedHistory.add(historyKey);
            throw error;
          }
          const turn = recovered;
          if (turn && !delivery.turnId) {
            await this.#mailbox.markRunning(delivery.id, turn.id);
          }
          if (turn?.status === "completed") {
            terminal = "completed";
            reason = "Recovered completed delivery after restart.";
          } else if (turn?.status === "failed") {
            terminal = "failed";
            reason = "The recovered Codex turn failed.";
          }
        }
      } catch {
        // Conservatively keep the interrupted result; never repeat uncertain side effects.
      }
      await this.#mailbox.markTerminal(delivery.id, terminal, terminal === "completed" ? null : reason);
      const agent = this.#store.list().find((candidate) => candidate.id === delivery.recipientAgentId);
      const threadId = this.#hooks.deliveryThreadId?.(delivery.id) ?? agent?.threadId;
      if (agent && threadId) {
        // Only the rows this recovery changes: a whole-chat read and write would hold the chat in
        // memory, and the working snapshot is a bounded view.
        const recoveryTurnId =
          delivery.turnId ?? this.#store.database.readConversationRuntime(agent.id, threadId).activeTurnId;
        const changedMessages = this.#store.database
          .readConversationRecoveryMessages(agent.id, threadId, recoveryTurnId)
          .filter((message) => message.turnId === recoveryTurnId && message.status === "streaming")
          .map((message) => {
            const changed = structuredClone(message);
            changed.status = terminal;
            markIncompleteImageGeneration(changed, terminal);
            return changed;
          });
        const revision = this.#store.database.persistConversationChanges({
          agentId: agent.id,
          threadId,
          activeTurnId: null,
          changedMessages,
          eventType: "turn.reconciled-after-restart",
          detail: { turnId: delivery.turnId, status: terminal },
        });
        const snapshot = structuredClone(this.#conversation.ensureSnapshot(agent.id, threadId));
        const changedById = new Map(changedMessages.map((message) => [message.id, message]));
        snapshot.messages = snapshot.messages.map((message) => changedById.get(message.id) ?? message);
        snapshot.activeTurnId = null;
        snapshot.revision = revision;
        // Clear the cached turn before queue listeners can read or change the agent.
        this.#conversation.setSnapshot(agent.id, snapshot);
        this.#conversation.publishConversation(snapshot);
      }
      this.#mailboxSync.emitQueue(delivery.recipientAgentId);
    }
  }

  recoverPersistedTurns(): void {
    for (const { delivery } of this.#mailbox.unresolvedDeliveries()) this.#orphanedDeliveryIds.add(delivery.id);
    for (const agent of this.threads()) {
      if (!agent.threadId) continue;
      // Only the rows that recovery can change: the streaming messages of the stale turn and the
      // unanswered prompts. A whole-chat read would hold every chat in memory at startup.
      const turnId = this.#store.database.readConversationRuntime(agent.id, agent.threadId).activeTurnId;
      const changedMessages = this.#store.database
        .readConversationRecoveryMessages(agent.id, agent.threadId, turnId)
        .flatMap((message) => {
          const changed = structuredClone(message);
          if (changed.questionPrompt?.resolution === null) changed.questionPrompt.resolution = { status: "expired" };
          if (turnId && changed.turnId === turnId && changed.status === "streaming") {
            changed.status = "interrupted";
            markIncompleteImageGeneration(changed, "interrupted");
          }
          return changed.questionPrompt?.resolution?.status === "expired" || changed.status === "interrupted"
            ? [changed]
            : [];
        });
      const changed = turnId !== null || changedMessages.length > 0;
      if (!changed) continue;
      const revision = this.#store.database.persistConversationChanges({
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        changedMessages,
        eventType: "turn.interrupted-by-restart",
        detail: { turnId },
      });
      const snapshot = structuredClone(this.#conversation.ensureSnapshot(agent.id, agent.threadId));
      const changedById = new Map(changedMessages.map((message) => [message.id, message]));
      snapshot.messages = snapshot.messages.map((message) => changedById.get(message.id) ?? message);
      snapshot.activeTurnId = null;
      snapshot.revision = revision;
      this.#conversation.setSnapshot(agent.id, snapshot);
    }
  }

  async backfillProviderHistory(): Promise<void> {
    for (const agent of this.threads()) {
      if (!agent.threadId) continue;
      // Inactive sessions still own history after an upgrade or provider switch.
      const active = this.#store.database.activeProviderSession(agent.threadId, agent.provider);
      for (const session of this.#store.database.listProviderSessions(agent.threadId)) {
        const client = this.#providers.clientFor(session.provider);
        if (!client?.readHistory) continue;
        const historyKey = `${session.provider}:${session.externalSessionId}`;
        if (this.#oversizedHistory.has(historyKey)) continue;
        try {
          // The workspace of the session the agent still runs on, and none for the retired ones: a
          // client that loads a session to read it must not reopen a session that was deliberately
          // replaced.
          const params =
            session.externalSessionId === active?.externalSessionId
              ? await this.#threads.threadParams(agent, client, session.externalSessionId)
              : { threadId: session.externalSessionId };
          const cwd = typeof params.cwd === "string" ? params.cwd : undefined;
          await importProviderHistory({
            database: this.#store.database,
            readHistory: client.readHistory,
            sessionId: session.id,
            provider: session.provider,
            externalSessionId: session.externalSessionId,
            agentId: agent.id,
            publicThreadId: agent.threadId,
            ...(cwd === undefined ? {} : { cwd }),
            findDelivery: (deliveryId) => this.#mailbox.getDelivery(deliveryId),
          });
          this.#refreshBackfilledConversation(agent.id, agent.threadId);
        } catch (error) {
          if (containsLineTooLong(error)) this.#oversizedHistory.add(historyKey);
          // The pages committed before the failure stay saved: show them.
          try {
            this.#refreshBackfilledConversation(agent.id, agent.threadId);
          } catch (refreshFailure) {
            this.#hooks.emitError("provider_history_backfill_pending", refreshFailure, agent.id);
          }
          this.#hooks.emitError("provider_history_backfill_pending", error, agent.id);
        }
      }
    }
  }

  /** Puts the newest page in the cache, keeps a running turn's live rows, and publishes a change. */
  #refreshBackfilledConversation(agentId: string, threadId: string): void {
    const page = this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, 100);
    const persisted = {
      agentId: page.agentId,
      threadId: page.threadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages,
    };
    const live = this.#conversation.loadedSnapshot(agentId);
    const next = live?.activeTurnId ? mergeConversationSnapshots(persisted, live) : persisted;
    const previousSignature = live ? conversationContentSignature(live) : null;
    this.#conversation.setSnapshot(agentId, next);
    const published = this.#conversation.loadedSnapshot(agentId) ?? next;
    const signature = conversationContentSignature(published);
    if (!live || signature !== previousSignature) this.#conversation.publishConversation(published, signature);
  }
}

/** Whether a failure, or one of its causes, is a provider line over the size limit. */
function containsLineTooLong(value: unknown): boolean {
  const seen = new Set<unknown>();
  let current = value;
  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current)) {
    seen.add(current);
    if (current instanceof LineTooLongError) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
