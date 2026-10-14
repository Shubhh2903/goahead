/**
 * The `openbot` tools that let an agent read and change routine flows, as the canvas does. A
 * request the model can correct, such as a cycle or an unknown agent, is a tool failure it reads;
 * other errors are faults.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import { RoutineFlowError } from "./routine-flow-store";
import type { RoutineFlows } from "./routine-flows";

const identifier = z.string().min(1).max(INPUT_LIMITS.identifier);
const listSchema = z.object({ agentId: identifier.optional() }).strict();
const connectSchema = z
  .object({
    routineId: identifier,
    fromAgentId: identifier,
    toAgentId: identifier,
    instruction: z.string().max(INPUT_LIMITS.routineInstruction).optional(),
  })
  .strict();
const disconnectSchema = z.object({ linkId: identifier }).strict();

export type RoutineFlowTools = Pick<RoutineFlows, "canvas" | "connect" | "disconnect">;

export const ROUTINE_FLOW_TOOL_DEFINITIONS = [
  {
    name: "list_routine_flows",
    description:
      "List the routines on an agent's routine canvas, yours when you omit agentId, and the links of each routine. A link hands one agent's answer in a routine run to the next agent.",
    shape: listSchema.shape,
  },
  {
    name: "connect_routine_agents",
    description:
      "Add a link to a routine flow: after fromAgentId answers in a run of routineId, its answer goes to toAgentId with the optional instruction. fromAgentId must be the routine's own agent or an agent the flow already reaches. The link applies to runs that start after it is made.",
    shape: connectSchema.shape,
  },
  {
    name: "disconnect_routine_agents",
    description:
      "Remove one link from a routine flow by its linkId from list_routine_flows. Links that only this link kept in the flow are removed too.",
    shape: disconnectSchema.shape,
  },
] as const;

const NAMES = new Set<string>(ROUTINE_FLOW_TOOL_DEFINITIONS.map((tool) => tool.name));

/** Answers a routine flow tool, or null when the tool is not one of them. */
export async function handleRoutineFlowTool(
  tool: string,
  args: unknown,
  senderAgentId: string,
  flows: RoutineFlowTools | null,
  agentIds: ReadonlySet<string>,
): Promise<OpenBotToolResponse | null> {
  if (!NAMES.has(tool)) return null;
  if (!flows) throw new Error("Routine flows are unavailable.");
  try {
    return await runRoutineFlowTool(tool, args, senderAgentId, flows, agentIds);
  } catch (error) {
    if (error instanceof RoutineFlowError) return openBotToolFailure(error.message);
    throw error;
  }
}

async function runRoutineFlowTool(
  tool: string,
  args: unknown,
  senderAgentId: string,
  flows: RoutineFlowTools,
  agentIds: ReadonlySet<string>,
): Promise<OpenBotToolResponse> {
  const unknownAgent = (ids: readonly string[]) => ids.find((id) => !agentIds.has(id));
  if (tool === "list_routine_flows") {
    const input = listSchema.parse(args ?? {});
    const agentId = input.agentId ?? senderAgentId;
    if (unknownAgent([agentId])) return openBotToolFailure(`Unknown agent: ${agentId}.`);
    const canvas = await flows.canvas(agentId);
    return openBotToolResult({
      routines: canvas.routines.map(({ routine }) => ({
        routineId: routine.id,
        name: routine.name,
        agentId: routine.agentId,
        active: routine.active,
      })),
      links: canvas.links.map((link) => ({
        linkId: link.id,
        routineId: link.routineId,
        fromAgentId: link.fromAgentId,
        toAgentId: link.toAgentId,
        instruction: link.instruction,
      })),
    });
  }
  if (tool === "connect_routine_agents") {
    const input = connectSchema.parse(args);
    const unknown = unknownAgent([input.fromAgentId, input.toAgentId]);
    if (unknown) return openBotToolFailure(`Unknown agent: ${unknown}.`);
    const link = await flows.connect({
      routineId: input.routineId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    });
    return openBotToolResult({ linkId: link.id });
  }
  const input = disconnectSchema.parse(args);
  await flows.disconnect(input);
  return openBotToolResult({ removed: input.linkId });
}
