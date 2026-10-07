import { describe, it, expect } from 'vitest';
import { checkInMoment, nextCheckIn, zonedDate, zonedTimeToUtc, DEFAULT_CHECK_IN_SCHEDULE } from './check-in.js';

describe('checkInMoment', () => {
  it('names the latest scheduled check-in at or before now, and the next', () => {
    // 14:30 Eastern on 2026-10-07 (EDT, UTC-4) is 18:30Z.
    const m = checkInMoment(new Date('2026-10-07T18:30:00Z'));
    expect(m).toMatchObject({ slot: 'afternoon', date: '2026-10-07' });
    expect(m.at.toISOString()).toBe('2026-10-07T18:00:00.000Z');
    expect(m.nextAt.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('a late or retried job still counts as that check-in; before the first slot it is yesterday’s last', () => {
    expect(checkInMoment(new Date('2026-10-07T18:00:00Z')).slot).toBe('afternoon');
    const early = checkInMoment(new Date('2026-10-07T08:00:00Z'));
    expect(early).toMatchObject({ slot: 'evening', date: '2026-10-06' });
  });

  it('takes a custom schedule with minutes', () => {
    const schedule = { timeZone: 'Europe/London', slots: { standup: { hour: 9, minute: 15 }, wrap: 17 } };
    const m = checkInMoment(new Date('2026-01-15T09:20:00Z'), schedule);
    expect(m).toMatchObject({ slot: 'standup', date: '2026-01-15' });
    expect(m.at.toISOString()).toBe('2026-01-15T09:15:00.000Z');
    expect(nextCheckIn(new Date('2026-01-15T09:20:00Z'), schedule)).toMatchObject({ slot: 'wrap' });
    expect(() => checkInMoment(new Date(), { timeZone: 'UTC', slots: {} })).toThrow();
  });

  it('zone helpers round-trip and handle DST', () => {
    expect(zonedDate(new Date('2026-10-07T03:00:00Z'), DEFAULT_CHECK_IN_SCHEDULE.timeZone)).toBe('2026-10-06');
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 9, minute: 0 }, 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 7, hour: 9, minute: 0 }, 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
  });
});
