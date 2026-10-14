import { z } from "zod";
import type { ThreadItem } from "./protocol";

/*
 * The MSP payloads that the Muse client reads. Each schema keeps only the fields the client uses and
 * drops the others, so a newer Muse that adds a field still decodes. A missing or wrongly typed field
 * that the client reads fails the decode.
 */
const text = z.string();
const int = z.number().int();

export const MuseItem = z.object({
  itemId: z.string().min(1),
  kind: z.string().min(1),
  revision: int,
  status: text,
  turnId: text.nullable().optional(),
  text: text.optional(),
  summary: z.array(text).optional(),
  tool: text.optional(),
  args: text.optional(),
  visibleOutput: text.optional(),
  commandText: text.optional(),
  exitCode: int.optional(),
  failureReason: text.optional(),
  outcome: text.optional(),
});
export type MuseItem = z.infer<typeof MuseItem>;

export const MuseItemEvent = z.object({ item: MuseItem });

export const MuseSession = z.object({
  session: z.object({ sessionId: z.string().min(1) }),
  history: z
    .object({
      mode: text,
      items: z.array(MuseItem).nullable(),
      snapshot: z.object({ schemaVersion: int, state: z.object({ items: z.array(MuseItem) }) }).nullable(),
    })
    .optional(),
});

export const MusePage = z.object({
  events: z.array(z.object({ method: text, params: z.record(text, z.unknown()) })),
  nextCursor: text.nullable(),
});
export type MusePage = z.infer<typeof MusePage>;

export const MuseModels = z.object({
  providerId: text,
  models: z.array(
    z.object({
      modelId: text,
      displayLabel: text,
      providerId: text,
      variants: z.union([z.array(text), z.literal("unknown")]).optional(),
      defaultReasoningEffort: text.optional(),
    }),
  ),
});

export const MuseApproval = z.object({
  approvalId: text,
  currentRequirementId: z.object({ approvalId: text, sourceIndex: int }),
  availableChoices: z.array(z.object({ choiceId: text, decision: text, scope: text })),
  subject: z.object({ kind: text, command: text.optional(), path: text.optional() }),
});
export type MuseApproval = z.infer<typeof MuseApproval>;

export const MuseUsage = z.object({
  turnId: text,
  cumulative: z.object({
    promptTokens: z.number(),
    totalTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
  }),
});

export const MuseTerminal = z.object({
  turnId: text,
  terminal: text,
  reason: text.optional(),
  error: z.object({ message: text }).optional(),
});

export const MuseUserInput = z.object({
  userInputId: text,
  questions: z.array(
    z.object({
      id: text,
      header: text,
      question: text,
      options: z.array(z.object({ label: text, description: text.optional() })),
      selection: z.object({ mode: z.enum(["single", "multiple"]) }),
    }),
  ),
});
export type MuseUserInput = z.infer<typeof MuseUserInput>;

/** Converts a native item without exposing raw provider arguments as diagnostic text. */
export function museThreadItem(item: MuseItem): ThreadItem {
  const common = { id: item.itemId, status: item.status };
  switch (item.kind) {
    case "agentMessage":
      return { ...common, type: "agentMessage", text: item.text ?? "" };
    case "userMessage":
      return { ...common, type: "userMessage", content: [{ type: "inputText", text: item.text ?? "" }] };
    case "reasoning":
      return {
        ...common,
        type: "reasoning",
        summary: (item.summary ?? []).map((value) => ({ type: "summaryText", text: value })),
      };
    case "userShell":
    case "commandExecution":
      return {
        ...common,
        type: "commandExecution",
        command: item.commandText ?? "",
        aggregatedOutput: item.visibleOutput ?? "",
        exitCode: item.exitCode ?? null,
      };
    case "compaction":
      return { ...common, type: "contextCompaction" };
    default:
      return {
        ...common,
        type: "mcpToolCall",
        server: "muse",
        tool: item.tool ?? item.kind,
        arguments: item.args ?? "",
        result: item.visibleOutput ?? item.text ?? "",
        error: item.failureReason ?? null,
      };
  }
}
