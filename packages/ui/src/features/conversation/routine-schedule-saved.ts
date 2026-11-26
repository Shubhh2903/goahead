import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { routineOnceAt, routineOnceInstant } from "@openbot/team-client/routine-schedule";
import {
  type RoutineDraftProblem,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
} from "@openbot/team-client/routine-schedule-draft";
import { currentText } from "../../text";
import { ROUTINE_DRAFT_KINDS } from "./routine-schedule-draft";

export { routineScheduleFromDraft, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";

/**
 * The kinds a routine can save. "Once" is offered on every host: a host without the native one-time
 * kind gets the shape that released GoAhead readers accept (`legacyOnceRoutineSchedule`).
 */
export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

export const ROUTINE_LOCAL_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

const PROBLEM_TEXT = {
  invalidDate: "routine.problem.invalidDate",
  cronRequired: "routine.problem.cronRequired",
  cronTooLong: "routine.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, AppTextKey>;

export function routineDraftProblem(draft: RoutineScheduleDraft, t: AppTranslate = currentText().t): string | null {
  const problem = routineDraftProblemCode(draft);
  return problem ? t(PROBLEM_TEXT[problem]) : null;
}

/** The one time of a native one-time routine, or of one that GoAhead v0.40/v0.41 saved as a long interval. */
function routineOnceTime(schedule: RoutineSchedule, timezone: string): Date | null {
  return schedule.kind === "once" ? routineOnceInstant(schedule, timezone) : routineOnceAt(schedule);
}

export function routineOncePassed(schedule: RoutineSchedule, timezone: string, now = new Date()): boolean {
  const at = routineOnceTime(schedule, timezone);
  return at !== null && at.getTime() <= now.getTime();
}

export function routineOnceCompleted(routine: {
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  updatedAt: string;
}): boolean {
  if (routine.active) return false;
  const at = routineOnceTime(routine.schedule, routine.timezone);
  return at !== null && Date.parse(routine.updatedAt) >= at.getTime();
}
