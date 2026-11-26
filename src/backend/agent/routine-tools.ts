import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isRoutineSchedule,
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type Routine,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  isOnceRoutineSchedule,
  onceRoutineSchedule,
  RoutineInputError,
  zonedRoutineInstant,
} from "@openbot/team-client/routine-schedule";
import { isRecord } from "../protocol";

export function routineToolArguments(value: unknown, allowedKeys: readonly string[]): DynamicRecord {
  if (!isRecord(value)) throw new RoutineInputError("Routine tool arguments are required.");
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new RoutineInputError(`Unexpected routine argument: ${unexpected}.`);
  return value;
}

export function routineToolAgentId(args: DynamicRecord, senderAgentId: string): string {
  if (args.agentId === undefined) return senderAgentId;
  return routineToolString(args.agentId, "agentId", INPUT_LIMITS.identifier, "agentId is required.");
}

export function routineToolString(value: unknown, field: string, limit: number, requiredMessage: string): string {
  if (!isString(value) || !value.trim()) throw new RoutineInputError(requiredMessage);
  if (value.length > limit) throw new RoutineInputError(`${field} is too long.`);
  return value;
}

export function siteToolString(value: unknown, field: string, limit: number): string {
  if (!isString(value) || !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > limit) throw new Error(`${field} is too long.`);
  return value.trim();
}

/** `timezone` is the zone of the routine: a `once` time without an offset is a clock time there. */
export function routineToolSchedule(value: unknown, timezone: string): RoutineSchedule {
  // The tool takes a one-time run as its own kind; the routine saves it as the shape every release reads.
  if (isDynamicRecord(value) && value.kind === "once") {
    if (!isString(value.at) || Object.keys(value).length !== 2) {
      throw new RoutineInputError(sourceText("error.backend.routineOnceTimeInvalid"));
    }
    return onceRoutineSchedule(routineToolOnceTime(value.at.trim(), timezone));
  }
  if (!isRoutineSchedule(value)) throw new RoutineInputError("The routine schedule is invalid.");
  // Validate the polling floor before the store runs so the provider gets a clear,
  // actionable error instead of a raw failure after the request. Custom cron schedules
  // still need a timezone and are checked by the routine store.
  if (value.kind === "interval" && intervalMinutes(value.amount, value.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES) {
    throw new RoutineInputError(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a daily, weekly, or cron schedule.`,
    );
  }
  if (
    value.kind === "advanced" &&
    value.time.kind === "every" &&
    intervalMinutes(value.time.amount, value.time.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES
  ) {
    throw new RoutineInputError(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a fixed time.`,
    );
  }
  return structuredClone(value);
}

function intervalMinutes(amount: number, unit: "minutes" | "hours" | "days"): number {
  return unit === "minutes" ? amount : unit === "hours" ? amount * 60 : amount * 1440;
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The shape every `openbot` namespace dynamic tool answers with. */
export interface OpenBotToolResponse {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

export function openBotToolResult(value: unknown): OpenBotToolResponse {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
  };
}

/**
 * A refusal the model is meant to read and act on, rather than a throw.
 *
 * `#handleServerRequest` turns a thrown error into an opaque JSON-RPC fault, which a model can only
 * give up on. `claude-client.ts` maps `success: false` onto `isError: true`, so both provider paths
 * show this as a failed tool call with the reason attached.
 */
export function openBotToolFailure(message: string): OpenBotToolResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: JSON.stringify({ error: message }) }],
  };
}

const ONCE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ONCE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * A time with `Z` or an offset is that instant. A time without one is a clock time in the routine's
 * zone, as every other clock value of the tool is. A date alone has no time and is refused.
 */
function routineToolOnceTime(value: string, timezone: string): Date {
  if (ONCE_DATE_ONLY.test(value)) throw new RoutineInputError(sourceText("error.backend.routineOnceTimeDateOnly"));
  const match = ONCE_DATE_TIME.exec(value);
  if (!match) throw new RoutineInputError(sourceText("error.backend.routineOnceTimeInvalid"));
  const [, year, month, day, hour, minute, second, offset] = match;
  const local = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? 0),
  };
  // A day that the month does not have, such as 31 February, is not a date: `Date.parse` would move
  // it into the next month.
  const daysInMonth = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  if (
    local.month < 1 ||
    local.month > 12 ||
    local.day < 1 ||
    local.day > daysInMonth ||
    local.hour > 23 ||
    local.minute > 59 ||
    local.second > 59
  ) {
    throw new RoutineInputError(sourceText("error.backend.routineOnceTimeInvalid"));
  }
  if (offset) {
    const at = Date.parse(value);
    if (!Number.isFinite(at)) throw new RoutineInputError(sourceText("error.backend.routineOnceTimeInvalid"));
    return new Date(at);
  }
  const at = zonedRoutineInstant(local, timezone);
  if (!at) throw new RoutineInputError(sourceText("error.backend.routineOnceTimeSkipped"));
  return at;
}

type RoutineToolView = Omit<Routine, "trigger"> & {
  trigger: Omit<Routine["trigger"], "schedule"> & { schedule: { kind: "once"; at: string } };
};

/**
 * The routine as the agent tool shows it. A one-time routine shows the `once` input the tool takes,
 * not its saved interval, so an agent does not report it as a repeating routine. Only the tool
 * output changes; the routine and every other reader keep the saved shape.
 */
export function routineToolView(routine: Routine): Routine | RoutineToolView {
  const { schedule } = routine.trigger;
  if (!isOnceRoutineSchedule(schedule)) return routine;
  return { ...routine, trigger: { ...routine.trigger, schedule: { kind: "once", at: schedule.anchorAt } } };
}
