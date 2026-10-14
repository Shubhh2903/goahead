// Calendar v3 calls for the `primary` calendar, and the free-slot math of `calendar_find_times`.
// https://developers.google.com/calendar/api/v3/reference/events

import { z } from "zod";
import { type GoogleApiClient, GoogleApiError } from "./google-api";

export const CALENDAR_MAX_RANGE_DAYS = 14;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const SLOT_LIMIT = 20;

export interface CalendarBusy {
  start: number;
  end: number;
}

export interface FreeSlot {
  start: string;
  end: string;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const eventTimeSchema = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const eventsSchema = z.object({
  items: z
    .array(
      z.object({
        status: z.string().optional(),
        transparency: z.string().optional(),
        start: eventTimeSchema,
        end: eventTimeSchema,
      }),
    )
    .optional(),
});
const insertedSchema = z.object({
  id: z.string(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
});

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function offsetMs(instant: number, timeZone: string): number {
  const wall = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant of `hour`:00 on `date` in `timeZone`. Two passes cover a daylight saving change. */
export function zonedTimeToUtc(date: CalendarDate, hour: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

function zonedDate(instant: number, timeZone: string): CalendarDate {
  const parts = zonedParts(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function nextDate(date: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export interface FreeSlotInput {
  from: number;
  to: number;
  durationMinutes: number;
  busy: CalendarBusy[];
  timeZone: string;
}

/** True for Saturday and Sunday. */
function isWeekend(date: CalendarDate): boolean {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The free gaps inside 09:00–18:00 of each day from Monday to Friday in `timeZone`, at least
 * `durationMinutes` long.
 */
export function freeSlots(input: FreeSlotInput): FreeSlot[] {
  const duration = input.durationMinutes * 60_000;
  const busy = [...input.busy].sort((left, right) => left.start - right.start);
  const slots: FreeSlot[] = [];
  let date = zonedDate(input.from, input.timeZone);
  for (let day = 0; day <= CALENDAR_MAX_RANGE_DAYS && slots.length < SLOT_LIMIT; day += 1) {
    const workStart = zonedTimeToUtc(date, WORK_START_HOUR, input.timeZone);
    if (workStart >= input.to) break;
    if (isWeekend(date)) {
      date = nextDate(date);
      continue;
    }
    const start = Math.max(input.from, workStart);
    const end = Math.min(input.to, zonedTimeToUtc(date, WORK_END_HOUR, input.timeZone));
    let cursor = start;
    for (const interval of busy) {
      if (interval.end <= cursor || interval.start >= end) continue;
      if (interval.start - cursor >= duration) {
        slots.push({ start: new Date(cursor).toISOString(), end: new Date(interval.start).toISOString() });
      }
      cursor = Math.max(cursor, interval.end);
    }
    if (end - cursor >= duration)
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
    date = nextDate(date);
  }
  return slots.slice(0, SLOT_LIMIT);
}

/** Epoch milliseconds of an event time. A `YYYY-MM-DD` date is local midnight in `timeZone`. NaN when not valid. */
function eventInstant(time: z.infer<typeof eventTimeSchema>, timeZone: string): number {
  if (time.dateTime) return Date.parse(time.dateTime);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(time.date ?? "");
  if (!match) return Number.NaN;
  return zonedTimeToUtc({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }, 0, timeZone);
}

export interface MeetingRequest {
  title: string;
  /** ISO times. */
  start: string;
  end: string;
  timeZone: string;
  guests: string[];
  description: string;
  /** Google creates one Meet conference for one request id. The same for each try of one booking. */
  requestId: string;
  /**
   * The event id that GoAhead gives (base32hex, 5 to 1024 characters), the same for each try of one
   * booking: a second insert of the same event answers 409, so a booking is never made twice.
   */
  eventId: string;
}

export class GoogleCalendarApi {
  readonly #api: GoogleApiClient;
  readonly #events: string;

  constructor(api: GoogleApiClient, baseUrl: string) {
    this.#api = api;
    this.#events = `${baseUrl}/calendars/primary/events`;
  }

  /**
   * The busy times of the primary calendar. A cancelled or "free" event is not busy. An all-day
   * event (a date with no time) starts and ends at local midnight in `timeZone`.
   */
  async busy(from: number, to: number, timeZone: string): Promise<CalendarBusy[]> {
    const params = new URLSearchParams({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const answer = await this.#api.json(`${this.#events}?${params}`, eventsSchema);
    return (answer.items ?? []).flatMap((event) => {
      if (event.status === "cancelled" || event.transparency === "transparent") return [];
      const start = eventInstant(event.start, timeZone);
      const end = eventInstant(event.end, timeZone);
      return Number.isFinite(start) && Number.isFinite(end) ? [{ start, end }] : [];
    });
  }

  /** Creates the event with a Google Meet link and sends the invitations (Task 6, after approval). */
  async insertMeet(
    meeting: MeetingRequest,
  ): Promise<{ eventId: string; meetLink: string | null; htmlLink: string | null }> {
    const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
    let answer: z.infer<typeof insertedSchema>;
    try {
      answer = await this.#insert(params, meeting);
    } catch (error) {
      // An earlier try created the event, and Google lost or failed the answer: it is booked.
      if (!(error instanceof GoogleApiError && error.status === 409)) throw error;
      answer = await this.#api.json(`${this.#events}/${encodeURIComponent(meeting.eventId)}`, insertedSchema);
    }
    return { eventId: answer.id, meetLink: answer.hangoutLink ?? null, htmlLink: answer.htmlLink ?? null };
  }

  #insert(params: URLSearchParams, meeting: MeetingRequest): Promise<z.infer<typeof insertedSchema>> {
    return this.#api.json(`${this.#events}?${params}`, insertedSchema, {
      method: "POST",
      body: {
        id: meeting.eventId,
        summary: meeting.title,
        description: meeting.description,
        start: { dateTime: meeting.start, timeZone: meeting.timeZone },
        end: { dateTime: meeting.end, timeZone: meeting.timeZone },
        attendees: meeting.guests.map((email) => ({ email })),
        conferenceData: {
          createRequest: { requestId: meeting.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      },
    });
  }
}
