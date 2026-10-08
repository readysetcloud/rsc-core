import { seededRandom } from './random.js';

// Human-like response delays. A person does not answer a message the instant it
// lands, so neither should an agent that is meant to feel like one: it waits a
// little before it acts on a trigger. The delay is a right-skewed (log-normal)
// sample sized by the kind of event (`profile`), scaled by the agent's own
// temperament (`lever`), with a chance of answering right away. The delay never
// runs into a deadline: it is clamped to a share of the time left before one, so
// a delayed agent still answers in time. The roll is seeded, so a redelivered
// event gets the same delay.
//
// Pure: callers pass `now`; nothing here reads a clock.

/** How slow an agent is, and how often it answers at once. Part of its persona. */
export interface ResponseDelayLever {
  /** Scales the profile's median and cap: 1 is a typical person, 0 always answers at once. */
  multiplier: number;
  /** Chance (0-1) of answering with no delay at all. */
  immediateChance: number;
}

/** No delay at all: for local dev, tests, and replays. */
export const IMMEDIATE_RESPONSE: ResponseDelayLever = { multiplier: 0, immediateChance: 1 };

/** A typical person: the profile's own timing, answering at once about one time in ten. */
export const TYPICAL_RESPONSE: ResponseDelayLever = { multiplier: 1, immediateChance: 0.1 };

export interface ResponseDelayProfile {
  /** Median delay before the multiplier. */
  medianMs: number;
  /** Longest delay before the multiplier. */
  capMs: number;
  /** At most this share of the time left before a deadline (leaves the task room to run). */
  deadlineShare: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const RESPONSE_DELAY_PROFILES = {
  /** A few seconds of think time: a turn the agent is on the clock for. */
  prompt: { medianMs: 5 * SECOND, capMs: 2 * MINUTE, deadlineShare: 0.4 },
  /** A reply in a conversation: minutes, not hours. */
  conversational: { medianMs: 3 * MINUTE, capMs: 30 * MINUTE, deadlineShare: 0.5 },
  /** Something worth mulling over (an offer, a request): under an hour, usually. */
  considered: { medianMs: 45 * MINUTE, capMs: 8 * HOUR, deadlineShare: 0.5 },
  /** Routine upkeep nobody is waiting on: whenever the agent next "looks". */
  routine: { medianMs: 90 * MINUTE, capMs: 12 * HOUR, deadlineShare: 0.5 },
} as const satisfies Record<string, ResponseDelayProfile>;
export type ResponseDelayProfileName = keyof typeof RESPONSE_DELAY_PROFILES;

/** Spread of the log-normal: a σ of 1 puts about a sixth of the delays past 2.7× the median. */
const SIGMA = 1;

export interface ResponseDelayInput {
  /** A built-in profile by name, or your own. */
  profile: ResponseDelayProfileName | ResponseDelayProfile;
  /** The seed, e.g. `${eventId}:${agentId}`, so a replayed event gets the same delay. */
  seed: string;
  lever: ResponseDelayLever;
  now: Date;
  /** The latest the task may start by (null or absent: no deadline besides the cap). */
  deadline?: Date | string | null;
}

export interface ResponseDelay {
  /** Milliseconds to wait before the task runs; 0 runs it right away. */
  delayMs: number;
  /** Why it came out as it did: the immediate roll, the cap, the deadline clamp, or a plain sample. */
  reason: 'immediate' | 'sampled' | 'capped' | 'deadline';
}

function resolveProfile(profile: ResponseDelayInput['profile']): ResponseDelayProfile {
  return typeof profile === 'string' ? RESPONSE_DELAY_PROFILES[profile] : profile;
}

/** A standard normal from two uniforms (Box-Muller). */
function normal(random: () => number): number {
  const u = Math.max(random(), Number.MIN_VALUE);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The most a delay may be before `deadline`: the profile's share of the time left, never below 0. */
export function deadlineLimitMs(
  profile: ResponseDelayInput['profile'],
  now: Date,
  deadline: Date | string | null | undefined,
): number {
  if (deadline === undefined || deadline === null) return Number.POSITIVE_INFINITY;
  const at = typeof deadline === 'string' ? Date.parse(deadline) : deadline.getTime();
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((at - now.getTime()) * resolveProfile(profile).deadlineShare));
}

/**
 * How long an agent waits before acting on a trigger. Always in [0, cap × multiplier], never past
 * the deadline clamp, and the same for the same seed.
 */
export function responseDelay(input: ResponseDelayInput): ResponseDelay {
  const { lever } = input;
  const random = seededRandom(`response-delay:${input.seed}`);
  if (random() < lever.immediateChance || lever.multiplier <= 0) return { delayMs: 0, reason: 'immediate' };
  const profile = resolveProfile(input.profile);
  const scale = lever.multiplier;
  const sampled = profile.medianMs * scale * Math.exp(SIGMA * normal(random));
  const cap = profile.capMs * scale;
  const limit = deadlineLimitMs(profile, input.now, input.deadline);
  const unclamped = Math.min(sampled, cap);
  const reason = limit < unclamped ? 'deadline' : cap < sampled ? 'capped' : 'sampled';
  return { delayMs: Math.floor(Math.min(unclamped, limit)), reason };
}
