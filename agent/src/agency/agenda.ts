// A persistent agenda: the typed, durable goals an agent is pursuing, kept
// beside (not inside) its natural-language memory.
//
// An event-triggered agent that only reacts rediscovers the same problem every
// time it wakes up, and a model's summary ("I should fix X") is lossy and has
// no completion condition. An agenda fixes that: goals are reconciled from
// state the host OBSERVES (a fresh authoritative read), never from what a model
// claims it did. A goal stays active across runs until an observation no longer
// reports the need; then it completes. Observations are idempotent (the same
// need again creates nothing), stale ones are rejected, and still-relevant
// goals keep their place ahead of newly discovered ones so an agent does not
// thrash between priorities from one run to the next.
//
// The agenda is generic: a goal is `{ kind, data }` with a caller-chosen stable
// `id`. Deciding what counts as a need is the host's job (`AgendaObservation`);
// deciding what to do about it is the task's job (`agendaLines` feeds the
// prompt). Persist it with `readAgentState` / `updateAgentState`
// (./state-store.ts), or any revision-checked store.

export const AGENDA_STATUSES = ['active', 'completed', 'expired', 'cancelled'] as const;
export type AgendaGoalStatus = (typeof AGENDA_STATUSES)[number];

export interface AgendaGoal<D = Record<string, unknown>> {
  /** Stable across observations: the same need reopens the same goal. */
  id: string;
  kind: string;
  status: AgendaGoalStatus;
  /** Whatever the goal is about; replaced whenever an observation reports it changed. */
  data: D;
  createdAt: string;
  updatedAt: string;
  /** The task whose observation last touched it. */
  sourceTaskId: string;
  /** The epoch (a week, a sprint, a day) the goal belongs to; null when epochs do not apply. */
  epoch: string | null;
}

export interface Agenda<D = Record<string, unknown>> {
  schemaVersion: 1;
  /** A closed agenda (the engagement ended) accepts no further observations. */
  closed: boolean;
  observedAt: string | null;
  epoch: string | null;
  goals: AgendaGoal<D>[];
}

export interface AgendaLimits {
  /** Active goals kept, in priority order; the rest wait for a later observation. */
  active: number;
  /** Settled goals kept, newest first, so a decision can recall what it finished. */
  history: number;
}

export const AGENDA_LIMITS: AgendaLimits = { active: 3, history: 12 };

export function emptyAgenda<D = Record<string, unknown>>(): Agenda<D> {
  return { schemaVersion: 1, closed: false, observedAt: null, epoch: null, goals: [] };
}

/** One need an observation found, in priority order: a goal to open or keep open. */
export interface AgendaNeed<D = Record<string, unknown>> {
  id: string;
  kind: string;
  data: D;
}

export interface AgendaObservation<D = Record<string, unknown>> {
  /** When the observation started: an older one than the last cannot revive anything. */
  at: string;
  taskId: string;
  /**
   * The needs the host verified, best first. Order matters only for needs that are new; a
   * still-open goal keeps its place.
   */
  needs: readonly AgendaNeed<D>[];
  /**
   * The epoch the observation belongs to (a week number, an ISO date, a sprint id). Goals from an
   * earlier epoch expire; an observation from an earlier epoch than the agenda's is ignored. Omit
   * (or pass null) when goals do not roll over.
   */
  epoch?: string | number | null;
  /** True when the engagement is over: every active goal is cancelled and the agenda closes. */
  closed?: boolean;
  /** Whether a reported need's `data` replaces the goal's; defaults to a shallow JSON comparison. */
  changed?(previous: D, next: D): boolean;
}

const sameData = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Pure reconciliation of an agenda against one observation. Repeated observations create no new
 * goals, stale reads (older `at`, earlier `epoch`) change nothing, a need that stops being reported
 * completes its goal, a new epoch expires the old one's goals, and `closed` cancels them all.
 */
export function reconcileAgenda<D = Record<string, unknown>>(
  current: Agenda<D>,
  observation: AgendaObservation<D>,
  limits: AgendaLimits = AGENDA_LIMITS,
): Agenda<D> {
  const { at, taskId } = observation;
  const closed = observation.closed === true;
  const epoch = observation.epoch === undefined || observation.epoch === null ? null : String(observation.epoch);
  if (current.closed) return current;
  if (current.observedAt !== null && Date.parse(at) < Date.parse(current.observedAt)) return current;
  if (current.epoch !== null && epoch !== null && epochBefore(epoch, current.epoch)) return current;
  const changed = observation.changed ?? sameDataChanged;
  const needs = new Map<string, AgendaNeed<D>>();
  if (!closed) for (const need of observation.needs) if (!needs.has(need.id)) needs.set(need.id, need);
  // A still-relevant goal stays ahead of newly discovered needs: no thrashing between runs.
  const retained = current.goals.filter((g) => g.status === 'active' && g.epoch === epoch && needs.has(g.id));
  const selected = [...new Set([...retained.map((g) => g.id), ...needs.keys()])].slice(0, limits.active);
  const active: AgendaGoal<D>[] = selected.map((id) => {
    const need = needs.get(id) as AgendaNeed<D>;
    // A goal from an earlier epoch is a different goal, even under the same id: it expires below.
    const previous = current.goals.find((g) => g.id === id && g.epoch === epoch);
    if (previous?.status === 'active' && !changed(previous.data, need.data)) return previous;
    return {
      id,
      kind: need.kind,
      status: 'active',
      data: need.data,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
      sourceTaskId: taskId,
      epoch,
    };
  });
  const activeIds = new Set(active.map((g) => g.id));
  const history = current.goals
    .filter((g) => !activeIds.has(g.id) || g.epoch !== epoch)
    .map((g): AgendaGoal<D> => {
      if (g.status !== 'active') return g;
      return {
        ...g,
        status: closed ? 'cancelled' : g.epoch !== epoch ? 'expired' : 'completed',
        updatedAt: at,
        sourceTaskId: taskId,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    closed,
    observedAt: at,
    epoch,
    goals: [...active, ...history.slice(0, limits.history)],
  };
}

function sameDataChanged(previous: unknown, next: unknown): boolean {
  return !sameData(previous, next);
}

/** Whether epoch `a` comes before `b`: numerically when both are numbers (weeks), else as strings (ISO dates). */
export function epochBefore(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na < nb;
  return a < b;
}

/** The goals the agent is pursuing now, best first. */
export function activeGoals<D>(agenda: Agenda<D> | null | undefined): AgendaGoal<D>[] {
  return agenda?.goals.filter((g) => g.status === 'active') ?? [];
}

/**
 * How much an option that serves a goal should be preferred among already-acceptable options:
 * `limits.active` for the top goal down to 1 for the last, 0 when it serves none. A preference,
 * never a permission: it does not make an option legal, affordable, or allowed.
 */
export function agendaPriority<D>(
  agenda: Agenda<D> | null | undefined,
  serves: (goal: AgendaGoal<D>) => boolean,
  limits: AgendaLimits = AGENDA_LIMITS,
): number {
  const index = activeGoals(agenda).findIndex(serves);
  return index < 0 ? 0 : Math.max(1, limits.active - index);
}

/**
 * The agenda as prompt lines: one per active goal, as `describe` words it. Give the model the
 * goal's id so its decision can name what it worked toward, and tell it what does NOT complete a
 * goal (a pending request is not a result).
 */
export function agendaLines<D>(
  agenda: Agenda<D> | null | undefined,
  describe: (goal: AgendaGoal<D>) => string,
): string[] {
  return activeGoals(agenda).map((g) => `[${g.id}] ${describe(g)} (pursuing since ${g.createdAt})`);
}
