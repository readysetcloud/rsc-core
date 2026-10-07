// Deterministic randomness for agency decisions. A persistent agent that rolls
// dice (how long to wait before answering, whether to speak up) must roll the
// same way when an event is redelivered or a run is replayed, so every roll here
// takes a seed and nothing reads a clock or Math.random.

/** 32-bit FNV-1a hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded generator of floats in [0, 1) (mulberry32). */
export function seededRandom(seed: string | number): () => number {
  let a = hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded yes/no roll: true with probability `chance` (0-1), the same answer
 * for the same seed. "Does this agent bite on the moment?" without a replay
 * ever changing its mind.
 */
export function seededRoll(chance: number, seed: string): boolean {
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return seededRandom(`roll:${seed}`)() < chance;
}
