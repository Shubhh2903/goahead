/**
 * Routine flows: an agent routine's answer handed on from agent to agent.
 *
 * The routine's own agent runs as it always has. When its run ends, its answer becomes the flow's
 * first step. Each link of the routine then sends that answer on to the next agent as a message
 * from the routine; an agent with several inputs waits until all of them are in and gets them in
 * one message. Its answer, once in, goes on the same way. An agent whose every input failed or was
 * skipped is skipped too, so a failure never leaves a flow waiting.
 *
 * Nothing here listens to the provider. The runtime looks at a run's own delivery and at the
 * deliveries it sent, whenever the agent service says a turn, a queue or a routine changed, and at
 * startup. That one sweep also covers the ends that raise no turn event: a delivery that failed to
 * start, and one a restart interrupted. Sweeps run one at a time; a request during a sweep runs one
 * more after it.
 *
 * A link only applies to the runs a routine starts after it was made, so connecting an agent never
 * sends it the answer of an earlier run.
 *
 * GoAhead routines start on a schedule only. Upstream OpenBot also starts them from a webhook; that
 * trigger is not part of GoAhead.
 */

import type {
  AgentEvent,
  ConnectRoutineFlowInput,
  DisconnectRoutineFlowInput,
  QueueDeliveryStatus,
  RemoveRoutineFlowPositionInput,
  RoutineFlowCanvas,
  RoutineFlowLink,
  RoutineFlowRoutine,
  RoutineFlowRoutineInfo,
  RoutineFlowStep,
  RoutineRun,
  SaveRoutineFlowPositionInput,
  UpdateRoutineFlowLinkInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { nextValidRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { routineFlowDepths } from "./routine-flow-graph";
import { RoutineFlowError, type RoutineFlowRun, type RoutineFlowStore } from "./routine-flow-store";

const logger = createOpenBotLogger("routine-flows");

/** How far back a sweep looks for a run whose flow may still move. */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A routine every three minutes fires a few thousand times a week; the canvas needs far fewer. */
const UPCOMING_LIMIT = 400;
const RECENT_RUNS = 10;

/** A delivery as the runtime reads it: whether it ended, and the turn that answered it. */
export interface RoutineFlowDelivery {
  status: QueueDeliveryStatus;
  turnId: string | null;
  error: string | null;
}

export interface RoutineFlowsDependencies {
  store: RoutineFlowStore;
  routines: {
    list(agentId: string): RoutineFlowRoutineInfo[];
    get(agentId: string, routineId: string): RoutineFlowRoutineInfo | null;
    listRuns(agentId: string, routineId: string, limit?: number): RoutineRun[];
  };
  delivery(deliveryId: string): RoutineFlowDelivery | null;
  /** The answer an agent gave in one turn, or null when it gave none. */
  turnAnswer(agentId: string, turnId: string): string | null;
  agentName(agentId: string): string;
  /** Queues the handoff message; answers the delivery id. The same key answers the same delivery. */
  sendHandoff(input: {
    run: Pick<RoutineFlowRun, "id" | "routineId" | "routineName" | "scheduledFor">;
    agentId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<string>;
  /** The agents whose canvases changed. */
  changed(agentIds: string[]): void;
  now?: () => Date;
}

/**
 * Owns the routine flow runtime: the canvas reads and edits, and the sweep that moves each run's
 * answer on. It never imports the agent service facade; the main process wires it to the service.
 */
export class RoutineFlows {
  readonly #dependencies: RoutineFlowsDependencies;
  readonly #store: RoutineFlowStore;
  /** The sweep running now, if any. */
  #running: Promise<void> | null = null;
  /** Whether another sweep was asked for while one ran. */
  #again = false;
  #closed = false;

  constructor(dependencies: RoutineFlowsDependencies) {
    this.#dependencies = dependencies;
    this.#store = dependencies.store;
  }

  async canvas(agentId: string): Promise<RoutineFlowCanvas> {
    const own = this.#dependencies.routines.list(agentId);
    const ownIds = new Set(own.map((routine) => routine.id));
    const others = this.#store
      .routineIdsTouching(agentId)
      .filter((routineId) => !ownIds.has(routineId))
      .map((routineId) => this.#routineOf(routineId))
      .filter((routine): routine is RoutineFlowRoutineInfo => routine !== null);
    const routines = [...own, ...others];
    const positions = this.#store.positions(agentId);
    return {
      agentId,
      routines: routines.map((routine) => this.#flowRoutine(routine)),
      links: this.#store.linksForRoutines(routines.map((routine) => routine.id)),
      positions,
      placedAgentIds: positions.flatMap((position) =>
        position.nodeKey.startsWith("agent:") ? [position.nodeKey.slice("agent:".length)] : [],
      ),
    };
  }

  async savePosition(input: SaveRoutineFlowPositionInput): Promise<void> {
    this.#store.savePosition(input.agentId, input.nodeKey, input.x, input.y);
  }

  async removePosition(input: RemoveRoutineFlowPositionInput): Promise<void> {
    this.#store.removePosition(input.agentId, input.nodeKey);
    this.#dependencies.changed([input.agentId]);
  }

  async connect(input: ConnectRoutineFlowInput): Promise<RoutineFlowLink> {
    const routine = this.#routineOf(input.routineId);
    if (!routine) throw new RoutineFlowError(sourceText("error.backend.routineGone"));
    const link = this.#store.createLink(routine.agentId, input, this.#now().toISOString());
    this.#dependencies.changed(this.#agentsOfRoutine(link.routineId));
    return link;
  }

  async updateLink(input: UpdateRoutineFlowLinkInput): Promise<RoutineFlowLink> {
    const link = this.#store.updateLinkInstruction(input.linkId, input.instruction);
    this.#dependencies.changed(this.#agentsOfRoutine(link.routineId));
    return link;
  }

  async disconnect(input: DisconnectRoutineFlowInput): Promise<void> {
    const before = this.#store.link(input.linkId);
    const affected = before ? this.#agentsOfRoutine(before.routineId) : [];
    this.#store.deleteLink(input.linkId, (routineId) => this.#store.routineOwner(routineId));
    this.#dependencies.changed(affected);
  }

  /**
   * Moves every flow that can move now. A call during a sweep asks for one more sweep after it and
   * resolves when that one ends. A failed sweep is logged, never thrown: the next event tries again.
   */
  sweep(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    // `#sweepLoop` always awaits before it ends, so its `finally` runs after this assignment.
    this.#running = this.#sweepLoop();
    return this.#running;
  }

  /** Asks for a sweep when an agent event may have ended a step. Returns at once. */
  notice(event: AgentEvent): void {
    if (event.type !== "turn-completed" && event.type !== "queue-changed" && event.type !== "routines-changed") return;
    void this.sweep();
  }

  /**
   * Stops new sweeps and waits for the one running. A handoff that a close stops before it is sent
   * stays a step without a delivery, and the first sweep after the next start sends it.
   */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#running;
  }

  async #sweepLoop(): Promise<void> {
    try {
      do {
        this.#again = false;
        try {
          await this.#sweepOnce();
        } catch (error) {
          logger.warn("A routine flow sweep failed.", { error: toLogValue(error) });
        }
      } while (this.#again && !this.#closed);
    } finally {
      // In the same step as the last check of `#again`, so no request falls between the two.
      this.#running = null;
    }
  }

  #now(): Date {
    return (this.#dependencies.now ?? (() => new Date()))();
  }

  #routineOf(routineId: string): RoutineFlowRoutineInfo | null {
    const ownerAgentId = this.#store.routineOwner(routineId);
    return ownerAgentId ? this.#dependencies.routines.get(ownerAgentId, routineId) : null;
  }

  /** Everyone whose canvas shows this routine: its agent and every agent its links name. */
  #agentsOfRoutine(routineId: string): string[] {
    const ownerAgentId = this.#store.routineOwner(routineId);
    const links = this.#store.linksForRoutines([routineId]);
    return [
      ...new Set([
        ...(ownerAgentId ? [ownerAgentId] : []),
        ...links.flatMap((link) => [link.fromAgentId, link.toAgentId]),
      ]),
    ];
  }

  #flowRoutine(routine: RoutineFlowRoutineInfo): RoutineFlowRoutine {
    const recentRuns = this.#dependencies.routines.listRuns(routine.agentId, routine.id, RECENT_RUNS);
    const newest = recentRuns[0];
    return {
      routine,
      recentRuns,
      upcomingRuns: routine.active ? upcoming(routine, this.#now()) : [],
      steps: newest ? this.#store.steps(newest.id) : [],
    };
  }

  /** The routine's own agent's part of a run that ended: its answer, or why there is none. */
  #recordOwnerStep(run: RoutineFlowRun): boolean {
    const delivery = run.deliveryId ? this.#dependencies.delivery(run.deliveryId) : null;
    if (run.status === "succeeded") {
      const output = delivery?.turnId ? this.#dependencies.turnAnswer(run.agentId, delivery.turnId) : null;
      return (
        this.#store.addStep({
          runId: run.id,
          agentId: run.agentId,
          input: run.instruction,
          status: "succeeded",
          output,
        }) !== null
      );
    }
    const status = run.status === "cancelled" ? "cancelled" : "failed";
    return (
      this.#store.addStep({
        runId: run.id,
        agentId: run.agentId,
        input: run.instruction,
        status,
        error: run.error ?? delivery?.error ?? null,
      }) !== null
    );
  }

  /** Ends a step whose delivery ended. Answers whether it changed. */
  #settleFromDelivery(step: RoutineFlowStep): boolean {
    if (!step.deliveryId) return false;
    const delivery = this.#dependencies.delivery(step.deliveryId);
    if (!delivery)
      return this.#store.settleStep(step.id, "failed", null, sourceText("error.backend.routineFlowLinkGone"));
    if (delivery.status === "completed") {
      const output = delivery.turnId ? this.#dependencies.turnAnswer(step.agentId, delivery.turnId) : null;
      return this.#store.settleStep(step.id, "succeeded", output, null);
    }
    if (delivery.status === "cancelled") return this.#store.settleStep(step.id, "cancelled", null, delivery.error);
    if (delivery.status === "failed" || delivery.status === "interrupted")
      return this.#store.settleStep(step.id, "failed", null, delivery.error);
    return false;
  }

  /**
   * Sends one step's input to its agent and keeps the delivery. The key is the step's, so a second
   * attempt after a restart finds the delivery the first one made instead of sending twice. A
   * handoff that cannot go out fails the step, and the agents after it are skipped. After `close`,
   * nothing is sent: the step keeps no delivery, and the next start sends it.
   */
  async #sendStep(run: RoutineFlowRun, step: RoutineFlowStep): Promise<void> {
    if (this.#closed) return;
    let deliveryId: string;
    try {
      deliveryId = await this.#dependencies.sendHandoff({
        run,
        agentId: step.agentId,
        text: step.input,
        idempotencyKey: `routine-flow-${step.id}`,
      });
    } catch (error) {
      logger.warn("A routine flow could not hand work on.", {
        runId: run.id,
        agentId: step.agentId,
        error: toLogValue(error),
      });
      this.#store.settleStep(step.id, "failed", null, sourceText("error.backend.routineFlowHandoffFailed"));
      return;
    }
    this.#store.attachDelivery(step.id, deliveryId);
  }

  /**
   * Sends a run's answers on as far as they can go now. Answers the agents it gave a step, so the
   * views showing them reload.
   */
  async #advance(run: RoutineFlowRun): Promise<Set<string>> {
    const changed = new Set<string>();
    const links = this.#store.linksForRoutines([run.routineId]).filter((link) => link.createdAt <= run.createdAt);
    if (links.length === 0) return changed;
    const depths = routineFlowDepths(run.agentId, links);
    const steps = new Map(this.#store.steps(run.id).map((step) => [step.agentId, step]));
    const order = [...depths.entries()]
      .filter(([agentId]) => agentId !== run.agentId)
      .sort((left, right) => left[1] - right[1])
      .map(([agentId]) => agentId);
    for (const agentId of order) {
      if (steps.has(agentId)) continue;
      const incoming = links.filter((link) => link.toAgentId === agentId && depths.has(link.fromAgentId));
      const sources = incoming.map((link) => ({ link, step: steps.get(link.fromAgentId) }));
      // Waits for every input: one that has not ended yet holds the agent back.
      if (sources.some(({ step }) => !step || step.status === "running")) continue;
      const answered = sources.filter(({ step }) => step?.status === "succeeded");
      if (answered.length === 0) {
        const skipped = this.#store.addStep({ runId: run.id, agentId, input: "", status: "skipped" });
        if (skipped) {
          steps.set(agentId, skipped);
          changed.add(agentId);
        }
        continue;
      }
      const text = handoffText(
        run.routineName,
        answered.map(({ link, step }) => ({
          from: this.#dependencies.agentName(link.fromAgentId),
          answer: step?.output ?? "",
          instruction: link.instruction,
        })),
      );
      const step = this.#store.addStep({ runId: run.id, agentId, input: text, status: "running" });
      if (!step) continue;
      steps.set(agentId, step);
      changed.add(agentId);
      await this.#sendStep(run, step);
      const current = this.#store.steps(run.id).find((candidate) => candidate.id === step.id);
      if (current) steps.set(agentId, current);
    }
    return changed;
  }

  async #sweepOnce(): Promise<void> {
    const since = new Date(this.#now().getTime() - SWEEP_WINDOW_MS).toISOString();
    const changed = new Set<string>();
    const runIds = new Set<string>();
    for (const run of this.#store.endedRunsWithoutOwnerStep(since)) {
      if (this.#recordOwnerStep(run)) {
        changed.add(run.agentId);
        runIds.add(run.id);
      }
    }
    for (const step of this.#store.runningSteps()) {
      // A step without a delivery lost its handoff to a restart between the two writes.
      if (!step.deliveryId) {
        const run = this.#store.run(step.runId);
        if (!run) continue;
        await this.#sendStep(run, step);
        changed.add(step.agentId);
        runIds.add(step.runId);
        continue;
      }
      if (this.#settleFromDelivery(step)) {
        changed.add(step.agentId);
        runIds.add(step.runId);
      }
    }
    // Also every run with a recent step: a restart between an answer and its handoff resumes here.
    for (const runId of this.#store.runIdsWithStepsSince(since)) runIds.add(runId);
    for (const runId of runIds) {
      const run = this.#store.run(runId);
      if (!run) continue;
      for (const agentId of await this.#advance(run)) changed.add(agentId);
      if (changed.size > 0) for (const agentId of this.#agentsOfRoutine(run.routineId)) changed.add(agentId);
    }
    if (changed.size > 0) this.#dependencies.changed([...changed]);
  }
}

/** The message an agent gets from the agents before it. The text goes to a provider, so it stays English. */
function handoffText(
  routineName: string,
  inputs: readonly { from: string; answer: string; instruction: string }[],
): string {
  const parts = inputs.map((input) => `${input.from} answered:\n\n${input.answer || "(no answer text)"}`);
  const instructions = [...new Set(inputs.map((input) => input.instruction.trim()).filter(Boolean))];
  const task = instructions.length > 0 ? instructions.join("\n\n") : "Do your part of the routine with this.";
  return `The routine "${routineName}" continues with you.\n\n${parts.join("\n\n---\n\n")}\n\n${task}`;
}

/** The times a routine fires in the next week, soonest first, from its schedule. */
function upcoming(routine: RoutineFlowRoutineInfo, from: Date): string[] {
  const schedule = routine.trigger.schedule;
  const end = from.getTime() + UPCOMING_WINDOW_MS;
  const times: string[] = [];
  try {
    for (
      let next = nextValidRoutineOccurrence(schedule, routine.timezone, from);
      next.getTime() < end && times.length < UPCOMING_LIMIT;
      // One millisecond on, so an occurrence never answers itself.
      next = nextValidRoutineOccurrence(schedule, routine.timezone, new Date(next.getTime() + 1))
    )
      times.push(next.toISOString());
  } catch (error) {
    // A schedule the store accepted always expands; if one does not, the canvas shows no times.
    logger.warn("A routine schedule did not expand.", { routineId: routine.id, error: toLogValue(error) });
  }
  return times;
}
