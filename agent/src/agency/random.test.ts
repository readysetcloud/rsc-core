import { describe, it, expect } from 'vitest';
import { hashString, seededRandom, seededRoll } from './random.js';

describe('random', () => {
  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('seeds a reproducible stream in [0, 1)', () => {
    const a = seededRandom('seed');
    const b = seededRandom('seed');
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it('rolls the same answer for the same seed and honors the extremes', () => {
    expect(seededRoll(0, 'x')).toBe(false);
    expect(seededRoll(1, 'x')).toBe(true);
    expect(seededRoll(0.5, 'event:agent')).toBe(seededRoll(0.5, 'event:agent'));
    const hits = Array.from({ length: 1000 }, (_, i) => seededRoll(0.3, `s${i}`)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(400);
  });
});
