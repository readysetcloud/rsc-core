import { describe, it, expect } from 'vitest';
import { responseDelay, deadlineLimitMs, IMMEDIATE_RESPONSE, TYPICAL_RESPONSE, RESPONSE_DELAY_PROFILES } from './response-delay.js';

const now = new Date('2026-10-07T12:00:00Z');

describe('responseDelay', () => {
  it('is immediate when the lever says so', () => {
    expect(responseDelay({ profile: 'considered', seed: 'a', lever: IMMEDIATE_RESPONSE, now })).toEqual({ delayMs: 0, reason: 'immediate' });
    expect(responseDelay({ profile: 'considered', seed: 'a', lever: { multiplier: 1, immediateChance: 1 }, now }).delayMs).toBe(0);
  });

  it('is deterministic for a seed and bounded by the cap times the multiplier', () => {
    const lever = { multiplier: 2, immediateChance: 0 };
    const cap = RESPONSE_DELAY_PROFILES.considered.capMs * 2;
    for (let i = 0; i < 200; i++) {
      const a = responseDelay({ profile: 'considered', seed: `e${i}:t`, lever, now });
      const b = responseDelay({ profile: 'considered', seed: `e${i}:t`, lever, now });
      expect(a).toEqual(b);
      expect(a.delayMs).toBeGreaterThanOrEqual(0);
      expect(a.delayMs).toBeLessThanOrEqual(cap);
      expect(['sampled', 'capped']).toContain(a.reason);
    }
  });

  it('never runs into a deadline', () => {
    const deadline = new Date(now.getTime() + 10 * 60_000);
    for (let i = 0; i < 100; i++) {
      const d = responseDelay({ profile: 'routine', seed: `e${i}`, lever: { multiplier: 1, immediateChance: 0 }, now, deadline });
      expect(d.delayMs).toBeLessThanOrEqual(5 * 60_000);
    }
    expect(deadlineLimitMs('routine', now, deadline)).toBe(5 * 60_000);
    expect(deadlineLimitMs('routine', now, null)).toBe(Number.POSITIVE_INFINITY);
    expect(deadlineLimitMs('routine', now, 'not a date')).toBe(Number.POSITIVE_INFINITY);
    expect(deadlineLimitMs('prompt', now, new Date(now.getTime() - 1000))).toBe(0);
  });

  it('takes a custom profile', () => {
    const d = responseDelay({ profile: { medianMs: 1000, capMs: 1000, deadlineShare: 1 }, seed: 'x', lever: { multiplier: 1, immediateChance: 0 }, now });
    expect(d.delayMs).toBeLessThanOrEqual(1000);
  });

  it('answers at once about immediateChance of the time', () => {
    const hits = Array.from({ length: 500 }, (_, i) => responseDelay({ profile: 'conversational', seed: `s${i}`, lever: TYPICAL_RESPONSE, now }))
      .filter((d) => d.reason === 'immediate').length;
    expect(hits).toBeGreaterThan(20);
    expect(hits).toBeLessThan(100);
  });
});
