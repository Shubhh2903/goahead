import type {
  AgentEvent,
  AgentHandoff,
  AgentHandoffStatus,
  AgentHandoffStep,
  QueueDeliveryStatus,
} from "@openbot/contracts/ipc";
import { AGENT_HANDOFF_LIMITS } from "@openbot/contracts/ipc";
import type { MailboxStore, MessagingOrigin } from "../mailbox-store";
import { getArray, getString, type ThreadItem } from "../protocol";
import { toolUsage } from "./thread-items";

/** One hand-off, and the external conversation its answer goes back to, such as a Slack thread. */
export interface HandoffRecord {
  handoff: AgentHandoff;
  messagingReturn: MessagingOrigin | null;
}

export interface HandoffActivityOptions {
  mailbox: Pick<MailboxStore, "teammateRequests">;
  hooks: {
    /** Removes secrets from text that leaves the backend. */
    redact(text: string): string;
    /** The hand-offs of this sender changed. */
    changed(agentId: string): void;
  };
}

/** The requests that one refresh reads. Enough for the newest hand-offs of every sender. */
const REQUEST_WINDOW = 500;
/** The recipient turns whose steps stay in memory. The oldest go first. */
const STEP_TURNS = 200;

/**
 * Owns the hand-off view of `send_message`: who asked whom to do what, how far the recipient is,
 * and the answer. Everything but the steps comes from the stored mailbox, so it survives a restart
 * with no new table; the steps of a recipient's turn are only in memory. Every text is redacted
 * and cut before it leaves. It never imports the agent service.
 */
export class HandoffActivity {
  readonly #mailbox: HandoffActivityOptions["mailbox"];
  readonly #hooks: HandoffActivityOptions["hooks"];
  /** The steps of recipient turns, by `<agentId>:<turnId>`, oldest turn first. */
  readonly #steps = new Map<string, AgentHandoffStep[]>();
  /** What each sender's list looked like when it was last announced. */
  readonly #signatures = new Map<string, string>();
  #refreshQueued = false;

  constructor(options: HandoffActivityOptions) {
    this.#mailbox = options.mailbox;
    this.#hooks = options.hooks;
  }

  /** The newest hand-offs that one agent sent, oldest first. */
  list(agentId: string): AgentHandoff[] {
    return this.records(agentId).map((record) => record.handoff);
  }

  records(agentId: string): HandoffRecord[] {
    return this.#all().get(agentId) ?? [];
  }

  /** Mailbox and turn events change a status or an answer. */
  event(event: AgentEvent): void {
    if (event.type === "queue-changed" || event.type === "turn-started" || event.type === "turn-completed") {
      this.#scheduleRefresh();
    }
  }

  /** A tool step started in a recipient's turn. Only its label is kept. */
  recordStep(agentId: string, turnId: string, item: ThreadItem): void {
    const found = handoffStep(item);
    if (!found) return;
    const step = { kind: found.kind, name: this.#text(found.name, AGENT_HANDOFF_LIMITS.stepName) };
    if (!step.name) return;
    const key = `${agentId}:${turnId}`;
    const steps = this.#steps.get(key) ?? [];
    const last = steps.at(-1);
    if (last?.kind === step.kind && last.name === step.name) return;
    steps.push(step);
    if (steps.length > AGENT_HANDOFF_LIMITS.steps) steps.splice(0, steps.length - AGENT_HANDOFF_LIMITS.steps);
    this.#steps.delete(key);
    this.#steps.set(key, steps);
    while (this.#steps.size > STEP_TURNS) {
      const oldest = this.#steps.keys().next().value;
      if (oldest === undefined) break;
      this.#steps.delete(oldest);
    }
    this.#scheduleRefresh();
  }

  /** Coalesces the events of one tick into one read of the mailbox. */
  #scheduleRefresh(): void {
    if (this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      this.#refresh();
    });
  }

  #refresh(): void {
    const all = this.#all();
    const changed: string[] = [];
    for (const [agentId, records] of all) {
      const signature = JSON.stringify(records);
      if (this.#signatures.get(agentId) === signature) continue;
      this.#signatures.set(agentId, signature);
      changed.push(agentId);
    }
    for (const agentId of [...this.#signatures.keys()]) {
      if (all.has(agentId)) continue;
      this.#signatures.delete(agentId);
      changed.push(agentId);
    }
    for (const agentId of changed) this.#hooks.changed(agentId);
  }

  #all(): Map<string, HandoffRecord[]> {
    const bySender = new Map<string, HandoffRecord[]>();
    for (const request of this.#mailbox.teammateRequests(REQUEST_WINDOW)) {
      const task = this.#text(request.text, AGENT_HANDOFF_LIMITS.task);
      for (const delivery of request.deliveries) {
        const reply = request.replies[delivery.recipientAgentId];
        const records = bySender.get(request.senderAgentId) ?? [];
        records.push({
          handoff: {
            id: delivery.id,
            messageId: request.messageId,
            fromAgentId: request.senderAgentId,
            toAgentId: delivery.recipientAgentId,
            task,
            startedAt: request.createdAt,
            status: handoffStatus(delivery.status),
            steps: delivery.turnId
              ? structuredClone(this.#steps.get(`${delivery.recipientAgentId}:${delivery.turnId}`) ?? [])
              : [],
            reply: reply ? this.#text(reply.text, AGENT_HANDOFF_LIMITS.reply) : null,
          },
          messagingReturn: request.messagingReturn,
        });
        bySender.set(request.senderAgentId, records);
      }
    }
    for (const [agentId, records] of bySender) bySender.set(agentId, records.slice(-AGENT_HANDOFF_LIMITS.list));
    return bySender;
  }

  /** Redacted before it is cut: a cut through a secret leaves a part no rule recognizes. */
  #text(text: string, limit: number): string {
    return clip(this.#hooks.redact(text).trim(), limit);
  }
}

function handoffStatus(status: QueueDeliveryStatus): AgentHandoffStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "starting":
    case "running":
      return "working";
    case "completed":
      return "done";
    default:
      return "failed";
  }
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const SHELLS = new Set(["sh", "bash", "zsh"]);

/**
 * The program a command runs, such as `go` for `/bin/zsh -lc "go build ./..."`. Only the name:
 * the arguments can hold a token, a path or a secret.
 */
function programName(command: string): string | null {
  let words = command.trim().split(/\s+/u);
  const shell = words[0]?.split("/").at(-1);
  if (shell && SHELLS.has(shell) && words[1]?.startsWith("-") && words[1].includes("c")) {
    words = words.slice(2).join(" ").replace(/^["']/u, "").trim().split(/\s+/u);
  }
  const program = words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word));
  const name = program
    ?.split("/")
    .at(-1)
    ?.replace(/[^A-Za-z0-9._+-]/gu, "");
  return name ? name : null;
}

/** A short label of one tool step, or null for an item that is not a tool step. */
export function handoffStep(item: ThreadItem): AgentHandoffStep | null {
  const usage = toolUsage(item);
  if (!usage) return null;
  const kind: AgentHandoffStep["kind"] =
    usage.kind === "command"
      ? "command"
      : usage.kind === "file_change"
        ? "edit"
        : usage.kind === "web_search" || usage.kind === "web_fetch"
          ? "search"
          : "tool";
  let name: string | null = null;
  if (item.type === "commandExecution") {
    const command = getString(item, "command");
    name = command ? programName(command) : null;
  } else if (item.type === "fileChange") {
    const path = getArray(item, "changes")
      .map((change) => getString(change, "path"))
      .find((value) => value !== null);
    name = path ? (path.split(/[\\/]/u).at(-1) ?? null) : null;
  } else if (item.type === "webSearch") {
    name = "web";
  } else if (item.type === "toolCall") {
    // An ACP agent's title is free text that can hold a command or a path, so only its kind is read.
    name = getString(item, "toolKind") ?? getString(item, "name");
  } else {
    name = usage.tool ?? getString(item, "tool");
  }
  if (!name) return null;
  return { kind, name: clip(name, AGENT_HANDOFF_LIMITS.stepName) };
}
