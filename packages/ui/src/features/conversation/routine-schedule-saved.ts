import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { routineOnceAt } from "@openbot/team-client/routine-schedule";
import {
  type RoutineDraftProblem,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
} from "@openbot/team-client/routine-schedule-draft";
import { currentText } from "../../text";
import { ROUTINE_DRAFT_KINDS } from "./routine-schedule-draft";

// The conversion between a draft and a saved schedule is shared with the phone.
export { routineScheduleFromDraft, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";

/** The kinds a routine can save. A one-time run saves as an interval that a released reader accepts. */
export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

const PROBLEM_TEXT = {
  once: "routine.problem.once",
  endBeforeStart: "routine.problem.endBeforeStart",
  invalidDate: "routine.problem.invalidDate",
  cronRequired: "routine.problem.cronRequired",
  cronTooLong: "routine.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, AppTextKey>;

/** Why the draft cannot be saved, or `null`. A save of such a draft would change when it runs. */
export function routineDraftProblem(draft: RoutineScheduleDraft, t: AppTranslate = currentText().t): string | null {
  const problem = routineDraftProblemCode(draft);
  return problem ? t(PROBLEM_TEXT[problem]) : null;
}

/** A one-time routine that is off after its time: it ran, or its time was missed. It shows as done, not paused. */
export function routineIsDone(active: boolean, schedule: RoutineSchedule, now = new Date()): boolean {
  const at = routineOnceAt(schedule);
  return !active && at !== null && at.getTime() <= now.getTime();
}
