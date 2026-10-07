// Durable commitments: what an agent took on, kept as typed operational state
// beside its agenda rather than in lossy natural-language memory.
//
// "I'll look into that" in a conversation is a promise. Without a record, the
// follow-up is fire-and-forget: a look that came to nothing is silently
// dropped, nothing remembers why, and nothing can come back to it when
// circumstances change. A commitment records what was asked, where, which
// task owes the work, what it decided and why, and whether that was ever
// reported back. Statuses move only through deterministic transitions driven
// by task results and external facts, never by a model's words, and only the
// task currently assigned may decide, so a duplicate or superseded delivery
// cannot.
//
// Lifecycle:
//
//   queued ──start──▶ evaluating ──waiting──▶ waiting_on_counterpart ──settle──▶ fulfilled | declined | cancelled | expired
//      │                   │
//      └──closed───────────┴──────────▶ declined | cancelled | failed | expired
//
// A decline the task marks `reconsider: true` (its facts could change) may be
// looked at again once per `maxReconsiderations`, after a cooldown, when the
// host finds a material change (`dueCommitments`). Everything else is final.
// Persist a book with `readAgentState` / `updateAgentState` (./state-store.ts).

export const COMMITMENT_STATUSES = [
  'queued',
  'evaluating',
  'waiting_on_counterpart',
  'fulfilled',
  'declined',
  'cancelled',
  'expired',
  'failed',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
const OPEN: ReadonlySet<CommitmentStatus> = new Set(['queued', 'evaluating', 'waiting_on_counterpart']);

export interface CommitmentLimits {
  /** Unresolved commitments per agent, and per counterpart. */
  active: number;
  perCounterpart: number;
  /** Settled commitments kept, newest first. */
  history: number;
  /** Tasks one commitment may run: the first look, a lost dispatch resumed, each reconsideration. */
  childTasks: number;
  /** A queued commitment whose task never started is `resume`d after this (a lost dispatch). */
  staleQueueMs: number;
  reconsiderCooldownMs: number;
  maxReconsiderations: number;
}

export const COMMITMENT_LIMITS: CommitmentLimits = {
  active: 3,
  perCounterpart: 1,
  history: 12,
  childTasks: 4,
  staleQueueMs: 60 * 60_000,
  reconsiderCooldownMs: 12 * 60 * 60_000,
  maxReconsiderations: 1,
};

export interface CommitmentDecision<F = Record<string, unknown>> {
  /** A short machine-friendly reason (`offer_sent`, `not_worth_it`, `deadline_passed`...). */
  reason: string;
  at: string;
  taskId: string;
  /** What the decision rested on: the agent's own numbers and needs, never the other party's words. */
  facts: F | null;
}

export interface Commitment<I = Record<string, unknown>, F = Record<string, unknown>> {
  /** `${kind}:${source.ref}`: the same source maps to one commitment. */
  id: string;
  kind: string;
  status: CommitmentStatus;
  createdAt: string;
  updatedAt: string;
  /** When a look not yet taken is given up on. */
  expiresAt: string;
  /** When a reconsiderable decline may be looked at again; null when it may not. */
  nextReviewAt: string | null;
  /** Who the commitment is to (a user, a team, a service); limits apply per counterpart. */
  counterpart: string;
  /** Where it came from, by reference: the text itself is never stored, a follow-up re-reads it. */
  source: { channel: string; ref: string; visibility: 'private' | 'shared' };
  /** The validated intent: what was asked, in the host's own typed terms. */
  intent: I;
  /** The agenda goal it could serve, when there is one. */
  agendaId: string | null;
  /** The tasks that owned it, oldest first; the last is the one allowed to decide. */
  childTaskIds: string[];
  /** The external thing it produced while waiting on the counterpart (an offer id, a ticket). */
  externalRef: string | null;
  decision: CommitmentDecision<F> | null;
  reconsiderations: number;
}

export interface CommitmentBook<I = Record<string, unknown>, F = Record<string, unknown>> {
  schemaVersion: 1;
  commitments: Commitment<I, F>[];
}

export function emptyCommitments<I = Record<string, unknown>, F = Record<string, unknown>>(): CommitmentBook<I, F> {
  return { schemaVersion: 1, commitments: [] };
}

export const isOpenCommitment = (c: Pick<Commitment, 'status'>): boolean => OPEN.has(c.status);
/** The task currently allowed to decide the commitment. */
export const currentTask = (c: Pick<Commitment, 'childTaskIds'>): string => c.childTaskIds[c.childTaskIds.length - 1] as string;

export interface CommitmentDraft<I = Record<string, unknown>> {
  kind: string;
  at: string;
  /** The follow-up task that will do the work. */
  taskId: string;
  counterpart: string;
  source: Commitment['source'];
  intent: I;
  expiresAt: string;
  agendaId?: string | null;
  /** Whether `intent` matches an open commitment's with the same counterpart; defaults to a JSON comparison. */
  sameIntent?(a: I, b: I): boolean;
}

export type OpenOutcome = 'created' | 'existing' | 'duplicate' | 'limit' | 'invalid';

function withCommitment<I, F>(book: CommitmentBook<I, F>, next: Commitment<I, F>, limits: CommitmentLimits): CommitmentBook<I, F> {
  const others = book.commitments.filter((c) => c.id !== next.id);
  const open = [next, ...others].filter(isOpenCommitment);
  const closed = [next, ...others]
    .filter((c) => !isOpenCommitment(c))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, limits.history);
  return { schemaVersion: 1, commitments: [...open, ...closed] };
}

/**
 * Validates and records a commitment. The same source again is `existing` (a redelivery), the
 * same intent still open with that counterpart is `duplicate`, and more open work than the limits
 * allow is `limit`: nothing new is recorded for those, nor for an `invalid` draft (a deadline
 * already past, or no counterpart).
 */
export function openCommitment<I, F = Record<string, unknown>>(
  book: CommitmentBook<I, F>,
  draft: CommitmentDraft<I>,
  limits: CommitmentLimits = COMMITMENT_LIMITS,
): { book: CommitmentBook<I, F>; outcome: OpenOutcome; commitment: Commitment<I, F> | null } {
  const id = `${draft.kind}:${draft.source.ref}`;
  const existing = book.commitments.find((c) => c.id === id);
  if (existing !== undefined) return { book, outcome: 'existing', commitment: existing };
  if (!draft.counterpart || !draft.taskId || Date.parse(draft.expiresAt) <= Date.parse(draft.at))
    return { book, outcome: 'invalid', commitment: null };
  const same = draft.sameIntent ?? ((a: I, b: I) => JSON.stringify(a) === JSON.stringify(b));
  const open = book.commitments.filter(isOpenCommitment);
  const dup = open.find((c) => c.counterpart === draft.counterpart && c.kind === draft.kind && same(c.intent, draft.intent));
  if (dup !== undefined) return { book, outcome: 'duplicate', commitment: dup };
  if (open.length >= limits.active || open.filter((c) => c.counterpart === draft.counterpart).length >= limits.perCounterpart)
    return { book, outcome: 'limit', commitment: null };
  const commitment: Commitment<I, F> = {
    id,
    kind: draft.kind,
    status: 'queued',
    createdAt: draft.at,
    updatedAt: draft.at,
    expiresAt: draft.expiresAt,
    nextReviewAt: null,
    counterpart: draft.counterpart,
    source: draft.source,
    intent: draft.intent,
    agendaId: draft.agendaId ?? null,
    childTaskIds: [draft.taskId],
    externalRef: null,
    decision: null,
    reconsiderations: 0,
  };
  return { book: withCommitment(book, commitment, limits), outcome: 'created', commitment };
}

export type CommitmentEvent<F = Record<string, unknown>> =
  /** The assigned task started its look. */
  | { type: 'start'; taskId: string }
  /** The assigned task did its part and now waits on the counterpart (an offer sent, a request filed). */
  | { type: 'waiting'; taskId: string; externalRef: string; reason?: string; facts?: F | null }
  /** The assigned task's final answer: why it is not going further. */
  | {
      type: 'closed';
      taskId: string;
      status: 'declined' | 'cancelled' | 'failed' | 'expired';
      reason: string;
      facts?: F | null;
      /** True when the facts behind a decline could change, so it is worth another look later. */
      reconsider?: boolean;
    }
  /** What the counterpart did about it, read from the system of record (never from chat). */
  | { type: 'settle'; status: 'fulfilled' | 'declined' | 'cancelled' | 'expired'; reason: string }
  /** Another task takes it over: a lost dispatch resumed, or a decline looked at again. */
  | { type: 'redispatch'; taskId: string; mode: 'resume' | 'reconsider' };

/**
 * Applies one event to commitment `id`, if it may: `applied` is false (and the book unchanged) for
 * an unknown id, a task that is not the assigned one, or an event its status does not allow.
 */
export function advanceCommitment<I, F = Record<string, unknown>>(
  book: CommitmentBook<I, F>,
  id: string,
  event: CommitmentEvent<F>,
  at: string,
  limits: CommitmentLimits = COMMITMENT_LIMITS,
): { book: CommitmentBook<I, F>; applied: boolean; commitment: Commitment<I, F> | null } {
  const c = book.commitments.find((x) => x.id === id);
  if (c === undefined) return { book, applied: false, commitment: null };
  const unchanged = { book, applied: false, commitment: c };
  const assigned = 'taskId' in event && event.type !== 'redispatch' ? currentTask(c) === event.taskId : true;
  if (!assigned) return unchanged;
  const decide = (status: CommitmentStatus, reason: string, taskId: string, facts: F | null, reconsider = false): Commitment<I, F> => ({
    ...c,
    status,
    updatedAt: at,
    decision: { reason, at, taskId, facts },
    nextReviewAt:
      status === 'declined' &&
      reconsider &&
      c.reconsiderations < limits.maxReconsiderations &&
      Date.parse(at) + limits.reconsiderCooldownMs < Date.parse(c.expiresAt)
        ? new Date(Date.parse(at) + limits.reconsiderCooldownMs).toISOString()
        : null,
  });
  let next: Commitment<I, F> | null = null;
  switch (event.type) {
    case 'start':
      if (c.status === 'queued') next = { ...c, status: 'evaluating', updatedAt: at };
      break;
    case 'waiting':
      if (c.status === 'queued' || c.status === 'evaluating')
        next = { ...decide('waiting_on_counterpart', event.reason ?? 'waiting', event.taskId, event.facts ?? null), externalRef: event.externalRef };
      break;
    case 'closed':
      if (c.status === 'queued' || c.status === 'evaluating')
        next = decide(event.status, event.reason, event.taskId, event.facts ?? null, event.reconsider === true);
      break;
    case 'settle':
      if (c.status === 'waiting_on_counterpart') next = decide(event.status, event.reason, currentTask(c), c.decision?.facts ?? null);
      break;
    case 'redispatch': {
      if (c.childTaskIds.includes(event.taskId) || c.childTaskIds.length >= limits.childTasks) break;
      const resume = event.mode === 'resume' && c.status === 'queued' && Date.parse(at) - Date.parse(c.updatedAt) >= limits.staleQueueMs;
      const reconsider =
        event.mode === 'reconsider' &&
        c.status === 'declined' &&
        c.nextReviewAt !== null &&
        Date.parse(c.nextReviewAt) <= Date.parse(at) &&
        Date.parse(at) < Date.parse(c.expiresAt);
      // The earlier decision stays until the new look replaces it, so its reason can be recalled.
      if (resume || reconsider)
        next = {
          ...c,
          status: 'queued',
          updatedAt: at,
          nextReviewAt: null,
          childTaskIds: [...c.childTaskIds, event.taskId],
          reconsiderations: c.reconsiderations + (reconsider ? 1 : 0),
        };
      break;
    }
  }
  if (next === null) return unchanged;
  return { book: withCommitment(book, next, limits), applied: true, commitment: next };
}

/**
 * Looks not taken by their deadline become `expired` (`deadline_passed`); returns them too. Work
 * already waiting on the counterpart waits for their answer, not this deadline.
 */
export function expireCommitments<I, F = Record<string, unknown>>(
  book: CommitmentBook<I, F>,
  at: string,
  limits: CommitmentLimits = COMMITMENT_LIMITS,
): { book: CommitmentBook<I, F>; expired: Commitment<I, F>[] } {
  let next = book;
  const expired: Commitment<I, F>[] = [];
  for (const c of book.commitments) {
    if ((c.status !== 'queued' && c.status !== 'evaluating') || Date.parse(c.expiresAt) > Date.parse(at)) continue;
    const result = advanceCommitment(next, c.id, { type: 'closed', taskId: currentTask(c), status: 'expired', reason: 'deadline_passed' }, at, limits);
    next = result.book;
    expired.push(result.commitment as Commitment<I, F>);
  }
  return { book: next, expired };
}

/**
 * What a check-in should pick up, oldest first: queued commitments whose task never started
 * (`resume`: a lost dispatch), and reconsiderable declines past their cooldown for which
 * `materialChange` finds something new (`reconsider`). Hand each to a new task with a
 * `redispatch` event, then dispatch that task.
 */
export function dueCommitments<I, F = Record<string, unknown>>(
  book: CommitmentBook<I, F>,
  at: string,
  materialChange: (c: Commitment<I, F>) => boolean = () => false,
  limits: CommitmentLimits = COMMITMENT_LIMITS,
): { resume: Commitment<I, F>[]; reconsider: Commitment<I, F>[] } {
  const now = Date.parse(at);
  const live = book.commitments
    .filter((c) => now < Date.parse(c.expiresAt) && c.childTaskIds.length < limits.childTasks)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    resume: live.filter((c) => c.status === 'queued' && now - Date.parse(c.updatedAt) >= limits.staleQueueMs),
    reconsider: live.filter(
      (c) => c.status === 'declined' && c.nextReviewAt !== null && Date.parse(c.nextReviewAt) <= now && materialChange(c),
    ),
  };
}

/** The commitments still open, for a check-in's "what do I owe" pass. */
export function openCommitments<I, F>(book: CommitmentBook<I, F> | null | undefined): Commitment<I, F>[] {
  return book?.commitments.filter(isOpenCommitment) ?? [];
}
