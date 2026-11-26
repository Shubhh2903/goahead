import type { RoutineFields, RoutineSchedule } from "@openbot/contracts/ipc";
import type { EventRoutine } from "@openbot/contracts/ipc-events";
import { nativeOnceRoutineSchedule } from "@openbot/team-client/routine-schedule";
import { routineDraftSummary } from "@openbot/ui/features/conversation/routine-schedule-draft";
import { routineScheduleToDraft } from "@openbot/ui/features/conversation/routine-schedule-saved";
import { type RoutineText, routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import type { RoutineEditorRecord } from "./routines-port";

export function isEventRoutine(routine: RoutineEditorRecord): routine is EventRoutine {
  return "owner" in routine;
}

/**
 * The routine's schedule as the editor shows it. A GoAhead v0.40/v0.41 host stores a one-time routine
 * as a 100,000-day interval; it reads as `{ kind: "once" }` here. The stored row is not changed.
 */
export function routineScheduleOf(routine: RoutineEditorRecord): RoutineSchedule {
  const schedule = isEventRoutine(routine)
    ? routine.trigger.kind === "schedule"
      ? routine.trigger.schedule
      : ({ kind: "daily", time: "09:00" } as const)
    : routine.trigger.schedule;
  try {
    return nativeOnceRoutineSchedule(schedule, routine.timezone);
  } catch {
    // An unknown timezone: show the stored shape.
    return schedule;
  }
}

export function routineListSummary(routine: RoutineEditorRecord, text: RoutineText): string {
  if (isEventRoutine(routine) && routine.trigger.kind === "webhook") {
    const eventType = routine.trigger.eventType;
    return eventType
      ? text.t("routine.settings.webhookSummary", { eventType })
      : text.t("routine.settings.webhookSummaryAny");
  }
  const schedule = routineScheduleOf(routine);
  const draft = routineScheduleToDraft(schedule);
  if (draft.kind === "custom") return routineScheduleSummary(schedule, false, text);
  return routineDraftSummary(draft, text);
}

export function routinePausedByRunLabel(
  routine: Pick<RoutineFields, "active" | "timezone" | "pausedByRun">,
  text: RoutineText,
  now = new Date(),
): string | undefined {
  const scheduledFor = routine.active ? undefined : routine.pausedByRun?.scheduledFor;
  if (!scheduledFor) return undefined;
  const runAt = new Date(scheduledFor);
  if (Number.isNaN(runAt.getTime())) return undefined;
  const timeZone = knownTimeZone(routine.timezone);
  const day = (date: Date) => text.format.date(date, { year: "numeric", month: "numeric", day: "numeric", timeZone });
  const time = text.format.date(
    runAt,
    day(runAt) === day(now)
      ? { hour: "numeric", minute: "2-digit", timeZone }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone },
  );
  return [text.t("routine.settings.pausedByRun", { time }), routineTimeZoneLabel(routine, text)]
    .filter(Boolean)
    .join(" · ");
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function routineTimeZoneLabel(routine: Pick<RoutineFields, "timezone">, text: RoutineText): string | undefined {
  const timeZone = knownTimeZone(routine.timezone);
  if (!timeZone || timeZone === localTimeZone()) return undefined;
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ");
  return text.t("routine.card.timeZone", { city: city ?? timeZone });
}

export function knownTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}
