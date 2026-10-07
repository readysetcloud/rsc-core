// Scheduled check-ins: the heartbeat that makes an agent act on its own.
//
// A purely reactive agent is silent until something happens to it. A person
// looks at their work a few times a day whether or not anything happened, so
// an agent that should feel present gets the same: a `check_in` trigger at
// fixed wall-clock times in its own time zone, where "nothing to do" is a fine
// answer (and ideally costs no model call). Emit the moment as an event on a
// schedule (an EventBridge rule, a cron), route it with a `oncePer` rule keyed
// by `date` and `slot`, and let the task review the agenda and open commitments.
//
// Pure: callers pass `now`.

export interface CheckInSchedule {
  /** IANA time zone the wall-clock times are in. */
  timeZone: string;
  /** Slot name → local hour (0-23) and optional minute. */
  slots: Record<string, number | { hour: number; minute?: number }>;
}

/** Morning, afternoon, and evening, US Eastern. */
export const DEFAULT_CHECK_IN_SCHEDULE: CheckInSchedule = {
  timeZone: 'America/New_York',
  slots: { morning: 9, afternoon: 14, evening: 20 },
};

export interface CheckInMoment {
  slot: string;
  /** The local calendar date of the check-in (`YYYY-MM-DD`); with `slot`, its once-only key. */
  date: string;
  /** When the check-in was scheduled. */
  at: Date;
  /** When the next one is. */
  nextAt: Date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formats.set(timeZone, f);
  }
  return f;
}

/** The wall-clock parts of `at` in `timeZone`. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of zoneFormat(timeZone).formatToParts(at)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return {
    year: parts.year as number,
    month: parts.month as number,
    day: parts.day as number,
    hour: (parts.hour as number) % 24,
    minute: parts.minute as number,
  };
}

function zoneOffsetMs(at: number, timeZone: string): number {
  const p = zonedParts(new Date(at), timeZone);
  const minute = Math.floor(at / 60_000) * 60_000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - minute;
}

/**
 * The instant a wall-clock time in a time zone happens. Days past the end of a month roll over, so
 * callers can add days. A time a daylight-saving jump skips resolves to an instant next to the jump.
 */
export function zonedTimeToUtc(local: ZonedParts, timeZone: string): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(guess, timeZone));
}

/** The zone's calendar date of `at`, as `YYYY-MM-DD`. */
export function zonedDate(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function slotTime(value: number | { hour: number; minute?: number }): { hour: number; minute: number } {
  return typeof value === 'number' ? { hour: value, minute: 0 } : { hour: value.hour, minute: value.minute ?? 0 };
}

/** The scheduled check-ins from the day before `now`'s local date to the day after, oldest first. */
function checkInsAround(now: Date, schedule: CheckInSchedule): { slot: string; at: Date }[] {
  const today = zonedParts(now, schedule.timeZone);
  const out: { slot: string; at: Date }[] = [];
  for (const offset of [-1, 0, 1]) {
    for (const [slot, value] of Object.entries(schedule.slots)) {
      const { hour, minute } = slotTime(value);
      out.push({ slot, at: zonedTimeToUtc({ ...today, day: today.day + offset, hour, minute }, schedule.timeZone) });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The check-in `now` belongs to: the latest scheduled one at or before `now` (a job that runs a
 * little late, or is retried, still counts as that check-in), and when the next one is.
 */
export function checkInMoment(now: Date, schedule: CheckInSchedule = DEFAULT_CHECK_IN_SCHEDULE): CheckInMoment {
  if (Object.keys(schedule.slots).length === 0) throw new Error('checkInMoment requires at least one slot');
  const around = checkInsAround(now, schedule);
  const t = now.getTime();
  let index = -1;
  for (let i = 0; i < around.length; i++) if (around[i]!.at.getTime() <= t) index = i;
  if (index < 0) index = 0;
  const current = around[index]!;
  const next = around[index + 1] ?? current;
  return { slot: current.slot, date: zonedDate(current.at, schedule.timeZone), at: current.at, nextAt: next.at };
}

/** The next check-in strictly after `now`. */
export function nextCheckIn(now: Date, schedule: CheckInSchedule = DEFAULT_CHECK_IN_SCHEDULE): { slot: string; at: Date } {
  const after = checkInsAround(now, schedule).find((c) => c.at.getTime() > now.getTime());
  if (after === undefined) throw new Error('nextCheckIn: no scheduled slot found');
  return after;
}
