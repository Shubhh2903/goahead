import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  AgentEvent,
  AgentSummary,
  ConversationMessage,
  ConversationSnapshot,
  QueueHold,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import type { MailboxStore } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { ConversationRuntime } from "./conversation-runtime";
import { conversationContentSignature } from "./delivery-content";
import type { RoutineScheduler } from "./routine-scheduler";

export interface MailboxSyncHooks {
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  /** What holds the queue back, when the reason is not this agent's own running turn. */
  queueHold(agentId: string): QueueHold | null;
}

export interface MailboxSyncOptions {
  database: OpenBotDatabase;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  routines: RoutineScheduler;
  hooks: MailboxSyncHooks;
}

/**
 * Keeps conversation snapshots merged with mailbox rows, and fans queue
 * state out to the renderer.
 *
 * Owns no durable state — every method reads the mailbox/database and writes
 * the in-memory snapshot. The facade keeps no wrappers: call sites use this
 * directly, and later extractions (drain, turn lifecycle) take it as a dep
 * instead of reaching into the mailbox themselves.
 */
export class MailboxSync {
  readonly #database: OpenBotDatabase;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #routines: RoutineScheduler;
  readonly #hooks: MailboxSyncHooks;

  constructor(options: MailboxSyncOptions) {
    this.#database = options.database;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#routines = options.routines;
    this.#hooks = options.hooks;
  }

  syncDeliveryMessage(snapshot: ConversationSnapshot, deliveryId: string): void {
    const context = this.#mailbox.getDelivery(deliveryId);
    const message = snapshot.messages.find((candidate) => candidate.id === deliveryId);
    if (!context || !message) return;
    if (context.delivery.turnId === null) delete message.turnId;
    else message.turnId = context.delivery.turnId;
    message.delivery = {
      id: context.delivery.id,
      status: context.delivery.status,
      position: context.delivery.position,
    };
  }

  /**
   * Merges the mailbox rows into a snapshot. The snapshot is a bounded recent view, so only the
   * mailbox rows from its oldest message on are read, with every active one.
   */
  syncMailboxMessages(snapshot: ConversationSnapshot, mailboxMessages?: readonly ConversationMessage[]): void {
    if (this.#conversation.isExecutionThread(snapshot.threadId)) return;
    const fromCreatedAt = snapshot.messages[0]?.createdAt;
    const incomingMailboxMessages =
      mailboxMessages ??
      this.#mailbox.conversationMessages(snapshot.agentId, fromCreatedAt === undefined ? {} : { fromCreatedAt });
    const indexes = new Map(snapshot.messages.map((message, index) => [message.id, index]));
    for (const mailboxMessage of incomingMailboxMessages) {
      const index = indexes.get(mailboxMessage.id);
      if (index !== undefined) snapshot.messages[index] = mailboxMessage;
      else {
        indexes.set(mailboxMessage.id, snapshot.messages.length);
        snapshot.messages.push(mailboxMessage);
      }
    }
    const reactions = this.#mailbox.reactionsFor(snapshot.agentId);
    for (const message of snapshot.messages) {
      message.reactions = reactions.get(message.id) ?? [];
      message.reaction = message.reactions.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;
    }
    sortConversationMessages(snapshot.messages);
  }

  reconcilePersistedMailboxMessages(agent: AgentSummary): void {
    if (!agent.threadId) return;
    // The newest page only: a full read would hold the whole chat in memory, and a whole-snapshot
    // write of a page would delete the rows it does not hold.
    const page = this.#database.readConversationPage(agent.id, agent.threadId, { type: "latest" }, 100);
    const persisted: ConversationSnapshot = {
      agentId: page.agentId,
      threadId: page.threadId,
      activeTurnId: page.activeTurnId,
      revision: page.revision,
      messages: page.messages,
    };
    const previousMessageIds = new Set(persisted.messages.map((message) => message.id));
    const previousSignature = conversationContentSignature(persisted);
    this.syncMailboxMessages(persisted);
    if (conversationContentSignature(persisted) === previousSignature) return;
    const currentIds = new Set(persisted.messages.map((message) => message.id));
    this.#database.persistConversationChanges({
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: persisted.activeTurnId,
      changedMessages: persisted.messages,
      removedMessageIds: [...previousMessageIds].filter((messageId) => !currentIds.has(messageId)),
      eventType: "conversation.mailbox-reconciled",
      detail: { messageCount: persisted.messages.length },
    });
    const live = this.#conversation.snapshot(agent.id);
    if (live) this.syncMailboxMessages(live);
  }

  /**
   * The queue the user reads, carrying the reason it waits when something outside this agent holds
   * it. `AgentService.listQueue` returns this as well, so a reload and a reconnect report the same
   * wait as the event below.
   */
  queueSnapshot(agentId: string): QueueSnapshot {
    const queue = this.#mailbox.listQueue(agentId);
    if (!queue.deliveries.some((delivery) => delivery.status === "queued")) return queue;
    const hold = this.#hooks.queueHold(agentId);
    return hold ? { ...queue, hold } : queue;
  }

  emitQueue(agentId: string): void {
    const queue = this.queueSnapshot(agentId);
    let routinesChanged = false;
    for (const delivery of queue.deliveries) {
      if (this.#routines.reconcileDelivery(delivery)) routinesChanged = true;
    }
    this.#hooks.emit({ type: "queue-changed", snapshot: queue });
    if (routinesChanged) this.#routines.stateChanged(agentId);
    const affectedAgents = new Set([agentId, ...this.#mailbox.senderAgentIdsForRecipient(agentId)]);
    for (const affectedAgentId of affectedAgents) {
      const snapshot = this.#conversation.snapshotToUpdate(affectedAgentId);
      if (!snapshot) continue;
      const previousSignature = conversationContentSignature(snapshot);
      this.syncMailboxMessages(snapshot);
      if (conversationContentSignature(snapshot) !== previousSignature) this.#conversation.emitConversation(snapshot);
      else if (!this.#conversation.hasPublishedConversation(affectedAgentId))
        this.#conversation.publishConversation(snapshot);
    }
  }

  /**
   * Publishes the queue and the conversation again after a delivery write failed. `turnId` and
   * `deliveryIds` name a turn that the provider accepted: its rows still in `starting` are moved to
   * `running` with that turn first, so a later drain does not submit the same turn again.
   */
  retryDeliveryReconciliation(agentId: string, turnId?: string, deliveryIds: readonly string[] = []): void {
    queueMicrotask(() => {
      void (async () => {
        // A provider response can arrive before the mailbox writes complete. The turn id came from the
        // provider. Check the active marker again so a delayed retry cannot claim a new turn's rows.
        const activeTurn = this.#conversation.workingSnapshot(agentId)?.activeTurnId;
        if (turnId && activeTurn === turnId) {
          for (const deliveryId of new Set(deliveryIds)) {
            const current = this.#mailbox.getDelivery(deliveryId)?.delivery;
            if (current?.recipientAgentId !== agentId || current.status !== "starting" || current.turnId !== null)
              continue;
            await this.#mailbox.markRunning(deliveryId, turnId);
          }
        }
        this.emitQueue(agentId);
        const snapshot = this.#conversation.snapshotToUpdate(agentId);
        if (snapshot) this.#conversation.emitConversation(snapshot);
      })().catch((error: unknown) => {
        this.#hooks.emitError("delivery_reconciliation_pending", error, agentId);
      });
    });
  }
}
