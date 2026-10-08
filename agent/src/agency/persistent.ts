import { finishTask, startTask, toTaskResult, type AgentTaskResult, type Principal } from '../memory/tasks.js';
import { TASK_COMPLETED_DETAIL_TYPE, type TaskRequestDetail, type TaskTrigger } from '../memory/task-events.js';
import { AGENDA_LIMITS, agendaLines, emptyAgenda, reconcileAgenda, type Agenda, type AgendaGoal, type AgendaLimits, type AgendaNeed } from './agenda.js';
import { checkInMoment, DEFAULT_CHECK_IN_SCHEDULE, type CheckInSchedule } from './check-in.js';
import {
  advanceCommitment,
  COMMITMENT_LIMITS,
  dueCommitments,
  emptyCommitments,
  expireCommitments,
  openCommitment,
  type Commitment,
  type CommitmentBook,
  type CommitmentDraft,
  type CommitmentEvent,
  type CommitmentLimits,
  type OpenOutcome,
} from './commitments.js';
import type { ResponseDelayInput } from './response-delay.js';
import { putEvents } from './put-events.js';
import { readAgentState, updateAgentState } from './state-store.js';
import {
  dynamoTriggerGates,
  eventBridgeDispatcher,
  humanDelay,
  routeTrigger,
  taskIdFor,
  type AgentPacing,
  type TriggerDecision,
  type TriggerDispatch,
  type TriggerEvent,
  type TriggerGates,
  type TriggerRule,
  type TriggerRuleMap,
} from './triggers.js';

// A persistent agent: the fourth agent type, next to chat, tasks, and one-shot
// runs. Where those are services a caller invokes, a persistent agent is a
// BUILD TOOL: your app defines a kind of agent (a reviewer, a league manager, a
// support rep) and runs it in its own stack. Each instance has a lasting
// identity and persona, paces itself, is woken by your rules and by scheduled
// check-ins, keeps an agenda and commitments across runs, and follows up on
// what it promised.
//
// `definePersistentAgent` wires the agency primitives into that shape and hands
// back the two handlers your stack deploys:
//
//   route(event)       your router (an EventBridge rule on your app's events and
//                      on "Agent Check-In"): rules + gates + delays → tasks
//   handleTask(detail) your consumer of "Run Agent Task": claim → load state →
//                      run the kind's handler → observe + reconcile → record
//
// Safety for agents nobody is watching: a retryable error (throttling, a
// timeout, a 5xx) is rethrown so the platform's own delivery retry runs the
// task again; `paused()` is a kill switch; and a per-agent task cap bounds
// runaway loops. None of these needs infrastructure beyond what you deploy.
//
// Its events use their own `source` (`agency.<name>`), never the shared
// service's `readysetcloud.agent`, so rsc-core's hosted task Lambda never runs
// them. Your handlers decide what the agent does (usually with runAgent or
// createAssistant from the package root); this module owns identity, pacing,
// idempotency, and durable state. It is Strands-free.

/** The `detail-type` of the scheduled heartbeat event `checkInEvent` builds. */
export const AGENT_CHECK_IN_DETAIL_TYPE = 'Agent Check-In';
/** The task kind a check-in requests. */
export const CHECK_IN_KIND = 'check_in';
/** The `detail-type` recorded on a follow-up task's trigger. */
export const FOLLOW_UP_DETAIL_TYPE = 'Agent Follow-Up';

/** The default per-agent task cap: 100 tasks in any rolling 24 hours. */
export const DEFAULT_TASK_CAP = { max: 100, windowMs: 24 * 60 * 60_000 } as const;

const RETRYABLE_ERRORS = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'ServiceUnavailableException',
  'ServiceUnavailable',
  'InternalServerException',
  'InternalServerError',
  'InternalFailure',
  'ModelNotReadyException',
  'ModelTimeoutException',
  'RequestTimeout',
  'RequestTimeoutException',
  'TimeoutError',
  'InternalException',
  'AgentStateConflictError',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

/**
 * The default for `isRetryable`: errors that clear up on their own. AWS SDK errors marked
 * `$retryable`, throttling and timeouts by name or code, network resets, HTTP 429 and 5xx, and
 * agent-state write contention. Everything else (bad input, a bug, a refused permission) is final.
 */
export function isRetryableError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { name?: unknown; code?: unknown; $retryable?: unknown; $metadata?: { httpStatusCode?: unknown }; statusCode?: unknown };
  if (e.$retryable) return true;
  if (typeof e.name === 'string' && RETRYABLE_ERRORS.has(e.name)) return true;
  if (typeof e.code === 'string' && RETRYABLE_ERRORS.has(e.code)) return true;
  const status = e.$metadata?.httpStatusCode ?? e.statusCode;
  return typeof status === 'number' && (status === 429 || status >= 500);
}

// ---------------------------------------------------------------------------
// Storage

/** Where a persistent agent's state lives: one document per agent, name, and scope. */
export interface PersistentStateKey {
  agentId: string;
  name: string;
  scope?: string;
}

/**
 * The durable side of a persistent agent: the idempotent task claim and its result, and the
 * revision-checked state documents. `dynamoAgentStore` is the production one; `memoryAgentStore`
 * is for tests and local runs.
 */
export interface PersistentAgentStore {
  /** Claims a task exactly once; a duplicate gets the existing result (or none while it runs). */
  claim(task: { taskId: string; principal: Principal; request: string }): Promise<
    { claimed: true } | { claimed: false; existing: AgentTaskResult | null }
  >;
  /** Records the claimed task's terminal result. */
  finish(result: AgentTaskResult): Promise<void>;
  read<T>(key: PersistentStateKey): Promise<T | null>;
  /** Read-modify-write; `update` must be pure (it may run again on a conflict). */
  update<T>(key: PersistentStateKey, update: (current: T | null) => T): Promise<T>;
}

/** The store on DynamoDB: task rows (`TASK#{taskId}`) and agent state (`AGENT#{agentId}`). */
export function dynamoAgentStore(options: { tableName?: string; stateTtlMs?: number } = {}): PersistentAgentStore {
  const table = options.tableName === undefined ? {} : { tableName: options.tableName };
  return {
    async claim(task) {
      const result = await startTask({ ...task, ...table });
      if (result.claimed) return { claimed: true };
      return { claimed: false, existing: result.existing ? toTaskResult(result.existing) : null };
    },
    async finish(result) {
      await finishTask({
        taskId: result.taskId,
        status: result.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        ...(result.output !== undefined ? { output: result.output } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...table,
      });
    },
    async read<T>(key: PersistentStateKey) {
      return (await readAgentState<T>({ ...key, ...table }))?.value ?? null;
    },
    async update<T>(key: PersistentStateKey, update: (current: T | null) => T) {
      const stored = await updateAgentState<T>({
        ...key,
        ...table,
        update,
        ...(options.stateTtlMs !== undefined ? { ttlMs: options.stateTtlMs } : {}),
      });
      return stored.value;
    },
  };
}

/** The store in memory, with the same claim semantics: for tests and local runs. */
export function memoryAgentStore(): PersistentAgentStore & {
  tasks: Map<string, AgentTaskResult>;
  state: Map<string, unknown>;
} {
  const tasks = new Map<string, AgentTaskResult>();
  const state = new Map<string, unknown>();
  const id = (key: PersistentStateKey) => `${key.agentId}\u0000${key.name}\u0000${key.scope ?? ''}`;
  return {
    tasks,
    state,
    async claim(task) {
      const current = tasks.get(task.taskId);
      if (current !== undefined && current.status !== 'PENDING' && current.status !== 'FAILED')
        return { claimed: false, existing: current.status === 'RUNNING' ? null : current };
      tasks.set(task.taskId, { taskId: task.taskId, status: 'RUNNING' });
      return { claimed: true };
    },
    async finish(result) {
      tasks.set(result.taskId, result);
    },
    async read<T>(key: PersistentStateKey) {
      const value = state.get(id(key));
      return value === undefined ? null : (structuredClone(value) as T);
    },
    async update<T>(key: PersistentStateKey, update: (current: T | null) => T) {
      const current = state.get(id(key));
      const next = update(current === undefined ? null : (structuredClone(current) as T));
      state.set(id(key), structuredClone(next));
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// Definition

/** One agent instance's persona and how it paces itself. */
export interface PersistentAgentProfile<P> {
  persona: P;
  pacing: AgentPacing;
}

/** What `observe` reports after a task: the verified needs, best first. */
export interface PersistentAgentObservation<N> {
  needs: readonly AgendaNeed<N>[];
  /** A week, a sprint, a date: goals from an earlier epoch expire. */
  epoch?: string | number | null;
  /** The engagement is over: every goal is cancelled and the agenda closes. */
  closed?: boolean;
}

/** A follow-up the agent sends itself (a later look, a second step). */
export interface PersistentFollowUp {
  kind: string;
  /** Distinguishes several follow-ups from one task; part of the follow-up's task id. */
  key: string;
  request: string;
  payload?: Record<string, unknown>;
  delayMs?: number;
}

/** A promise to record: a commitment draft plus the request its follow-up task runs. */
export type PersistentPromise<I> = Omit<CommitmentDraft<I>, 'at' | 'taskId'> & {
  request: string;
  payload?: Record<string, unknown>;
  delayMs?: number;
};

/** What a task handler is given. */
export interface PersistentTaskContext<P, N, I, F> {
  agentType: string;
  agentId: string;
  persona: P;
  principal: Principal;
  taskId: string;
  /** The task kind (the trigger rule's `kind`, or `check_in`, or a follow-up's kind). */
  kind: string;
  request: string;
  trigger: TaskTrigger;
  /** The rule's payload for this task (ids, deadlines): never untrusted event text. */
  payload: Record<string, unknown>;
  /** When the task started. */
  now: Date;
  scope: string | undefined;
  /** The agenda as of the start of the task. */
  agenda: Agenda<N>;
  /** The commitments, after expiring looks never taken; refreshed by the methods below. */
  commitments: CommitmentBook<I, F>;
  /** The commitment this task owns, when it is a promise's follow-up. */
  commitment: Commitment<I, F> | null;
  /** The active goals as prompt lines, worded by `describe`. */
  agendaLines(describe: (goal: AgendaGoal<N>) => string): string[];
  /** Read-modify-write of the commitment book. */
  updateCommitments(update: (book: CommitmentBook<I, F>) => CommitmentBook<I, F>): Promise<CommitmentBook<I, F>>;
  /** Applies one lifecycle event to a commitment; false when it may not (not the assigned task, wrong status). */
  advanceCommitment(id: string, event: CommitmentEvent<F>): Promise<boolean>;
  /** Records a promise and, when it is new, dispatches the follow-up task that owns it. */
  promise(promise: PersistentPromise<I>): Promise<OpenOutcome>;
  /** Dispatches a follow-up task for this agent; returns its task id. */
  followUp(followUp: PersistentFollowUp): Promise<string>;
  /** Commitments a check-in should pick up: lost looks to resume, declines whose facts changed. */
  dueCommitments(materialChange?: (c: Commitment<I, F>) => boolean): { resume: Commitment<I, F>[]; reconsider: Commitment<I, F>[] };
  /** Hands a due commitment to a new follow-up task (`resume` or `reconsider`); false when it may not. */
  redispatch(commitment: Commitment<I, F>, mode: 'resume' | 'reconsider', request: string): Promise<boolean>;
}

export type PersistentTaskHandler<P, N, I, F> = (
  ctx: PersistentTaskContext<P, N, I, F>,
) => Promise<string | { output: string }> | string | { output: string };

export interface PersistentAgentCheckIn {
  /** Wall-clock slots and time zone; defaults to 9:00, 14:00, 20:00 US Eastern. */
  schedule?: CheckInSchedule;
  /** The agent ids of this type that check in. */
  agents(): readonly string[] | Promise<readonly string[]>;
  /** The check-in task's instruction. */
  request?: string;
  /** Response-delay profile for wandering in after the slot; default `routine`. */
  profile?: ResponseDelayInput['profile'];
}

export interface PersistentAgentDefinition<P, N, I, F> {
  /** The agent type (`reviewer`, `league-manager`): namespaces gates, state, and check-ins. */
  name: string;
  /** An instance's persona and pacing, or null when the id is not an agent of this type. */
  profile(agentId: string): Promise<PersistentAgentProfile<P> | null> | PersistentAgentProfile<P> | null;
  /** What wakes it: trigger rules by event `detail-type`. Each rule's `kind` needs a task handler. */
  rules?: TriggerRuleMap;
  /** What it does, by task kind. Include `check_in` when `checkIn` is set. */
  tasks: Record<string, PersistentTaskHandler<P, N, I, F>>;
  /**
   * After a task succeeds: a fresh, authoritative read of what the agent still needs. The agenda is
   * reconciled from this, never from the handler's output. Return null when the read failed.
   */
  observe?(ctx: PersistentTaskContext<P, N, I, F>): Promise<PersistentAgentObservation<N> | null> | PersistentAgentObservation<N> | null;
  /** Isolates state (a tenure, a season): a new scope starts empty. */
  scope?(agentId: string, persona: P): string | undefined;
  /** The principal its tasks run as; default `{ type: 'system', id: '<name>/<agentId>' }`. */
  principal?(agentId: string): Principal;
  /** The scheduled heartbeat; emit `checkInEvent()` from a cron. */
  checkIn?: PersistentAgentCheckIn;
  agendaLimits?: AgendaLimits;
  commitmentLimits?: CommitmentLimits;
  /** Human-like delays on (production) or off (tests, local runs); default on. */
  responseDelays?: boolean;
  /** Defaults to `dynamoAgentStore({ tableName })`. */
  store?: PersistentAgentStore;
  /** Defaults to `dynamoTriggerGates({ prefix: name, tableName })`. */
  gates?: TriggerGates;
  /** Defaults to `eventBridgeDispatcher({ eventBusName })`. */
  dispatch?(task: TriggerDispatch): Promise<void>;
  /** Called with every finished task; defaults to emitting "Agent Task Completed" from `source`. */
  onComplete?(result: AgentTaskResult, context: { agentId: string; principal: Principal; kind: string }): Promise<void>;
  /**
   * The kill switch: while it returns true, `route` dispatches nothing and `handleTask` runs nothing
   * (tasks that arrive are dropped unclaimed). Back it with whatever you can flip without a deploy:
   * an environment variable, a parameter, a table row. Queued promises resume at the next check-in.
   */
  paused?(): boolean | Promise<boolean>;
  /**
   * The most tasks one agent may run in a rolling window, counted per task id (a redelivery or a
   * retry is not counted twice). Bounds runaway loops of check-ins, follow-ups, and promises.
   * Default `DEFAULT_TASK_CAP` (100 a day); null turns it off.
   */
  taskCap?: { max: number; windowMs: number } | null;
  /**
   * Which errors give the task back for another delivery instead of failing it for good. A
   * retryable error is rethrown, so your task Lambda's invocation fails and EventBridge (or Lambda's
   * async retry) delivers the task again; the claim is released so that delivery can run it.
   * Default `isRetryableError`. Pass `() => false` to never retry.
   */
  isRetryable?(error: unknown): boolean;
  tableName?: string;
  eventBusName?: string;
  /**
   * The EventBridge `source` for this type's task requests, check-ins, and completions; default
   * `agency.<name>`. Point your consumer's rule at it. It must not be `readysetcloud.agent`, the
   * shared service's source, or the shared task Lambda would run these tasks too.
   */
  source?: string;
  now?(): Date;
  log?(entry: Record<string, unknown>): void;
}

export interface PersistentAgent {
  name: string;
  /** The EventBridge `source` of this type's task requests, check-ins, and completions. */
  source: string;
  /** The effective rules, check-in included. */
  rules: TriggerRuleMap;
  /** Your router's handler: routes one event to the agents of this type it concerns. */
  route(event: TriggerEvent): Promise<TriggerDecision[]>;
  /** Your "Run Agent Task" consumer: runs one task for one agent of this type. */
  handleTask(detail: TaskRequestDetail): Promise<AgentTaskResult>;
  /** The PutEvents entry for the current check-in slot. */
  checkInEvent(now?: Date): { Source: string; DetailType: string; Detail: string; EventBusName?: string };
  /** Emits `checkInEvent(now)`. Call it from a cron at each slot. */
  emitCheckIn(now?: Date): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

/**
 * Defines a persistent agent type and returns the router and task handler your stack runs.
 * Throws when a rule requests a task kind with no handler.
 */
export function definePersistentAgent<P = unknown, N = Record<string, unknown>, I = Record<string, unknown>, F = Record<string, unknown>>(
  definition: PersistentAgentDefinition<P, N, I, F>,
): PersistentAgent {
  const { name } = definition;
  if (!name) throw new Error('definePersistentAgent requires a name');
  const clock = definition.now ?? (() => new Date());
  const alimits = definition.agendaLimits ?? AGENDA_LIMITS;
  const climits = definition.commitmentLimits ?? COMMITMENT_LIMITS;
  const store = definition.store ?? dynamoAgentStore(definition.tableName === undefined ? {} : { tableName: definition.tableName });
  const gates =
    definition.gates ?? dynamoTriggerGates({ prefix: name, ...(definition.tableName === undefined ? {} : { tableName: definition.tableName }) });
  const source = definition.source ?? `agency.${name}`;
  if (source === 'readysetcloud.agent')
    throw new Error(`definePersistentAgent(${name}): source "readysetcloud.agent" belongs to the shared service; persistent agents run in your stack`);
  const bus = definition.eventBusName === undefined ? {} : { EventBusName: definition.eventBusName };
  const dispatch =
    definition.dispatch ??
    eventBridgeDispatcher({ source, ...(definition.eventBusName === undefined ? {} : { eventBusName: definition.eventBusName }) });
  const principalOf = definition.principal ?? ((agentId: string): Principal => ({ type: 'system', id: `${name}/${agentId}` }));
  const schedule = definition.checkIn?.schedule ?? DEFAULT_CHECK_IN_SCHEDULE;
  const cap = definition.taskCap === undefined ? DEFAULT_TASK_CAP : definition.taskCap;
  if (cap !== null && (!(cap.max >= 1) || !(cap.windowMs > 0)))
    throw new Error(`definePersistentAgent(${name}): taskCap needs max ≥ 1 and windowMs > 0, or null`);
  const isRetryable = definition.isRetryable ?? isRetryableError;
  const isPaused = async () => (definition.paused === undefined ? false : await definition.paused());

  /** Counts `taskId` against the agent's cap, once per task id; false when the cap is reached. */
  async function admitTask(agentId: string, taskId: string): Promise<boolean> {
    if (cap === null) return true;
    type Usage = { tasks: { id: string; at: number }[] };
    let allowed = false;
    await store.update<Usage>({ agentId, name: `${name}.usage` }, (current) => {
      const nowMs = clock().getTime();
      const live = (current?.tasks ?? []).filter((t) => nowMs - t.at < cap.windowMs);
      if (live.some((t) => t.id === taskId)) {
        allowed = true;
        return { tasks: live };
      }
      allowed = live.length < cap.max;
      return { tasks: allowed ? [...live, { id: taskId, at: nowMs }] : live };
    });
    return allowed;
  }
  const onComplete =
    definition.onComplete ??
    (async (result: AgentTaskResult, context: { agentId: string; principal: Principal; kind: string }) => {
      await putEvents([{
        Source: source,
        DetailType: TASK_COMPLETED_DETAIL_TYPE,
        Detail: JSON.stringify({ ...result, principal: context.principal, agentType: name, agentId: context.agentId, kind: context.kind }),
        ...bus,
      }]);
    });

  // Completion delivery survives any single failure. A durable "completion owed" record is written
  // while the task is still RUNNING, before the result becomes final; it is cleared only after the
  // completion is published. So once a task is final, either its completion went out or the record
  // says it is owed, and the next delivery of the task (which stops at the claim) publishes it.
  //
  //   owed record fails  → nothing is final yet: the claim is given back and the task is retried
  //   finish fails       → the task stays RUNNING (the crash window a recovery sweep would cover)
  //   publish fails      → the record stays: the next delivery publishes the completion
  //   clearing fails     → the next delivery publishes again: completions are at-least-once
  type Undelivered = { results: { result: AgentTaskResult; kind: string }[] };
  const undeliveredKey = (agentId: string): PersistentStateKey => ({ agentId, name: `${name}.undelivered` });
  async function settle(result: AgentTaskResult, context: { agentId: string; principal: Principal; kind: string }) {
    try {
      await store.update<Undelivered>(undeliveredKey(context.agentId), (current) => ({
        results: [...(current?.results ?? []).filter((r) => r.result.taskId !== result.taskId), { result, kind: context.kind }].slice(-100),
      }));
    } catch (err) {
      await store.finish({ taskId: result.taskId, status: 'FAILED', error: `Retrying: ${message(err)}` }).catch(() => undefined);
      definition.log?.({ agentType: name, agentId: context.agentId, taskId: result.taskId, decision: 'retry', error: message(err) });
      throw err;
    }
    await store.finish(result);
    try {
      await onComplete(result, context);
    } catch (err) {
      definition.log?.({ agentType: name, agentId: context.agentId, taskId: result.taskId, decision: 'completion_undelivered', error: message(err) });
      throw err;
    }
    await store.update<Undelivered>(undeliveredKey(context.agentId), (current) => ({
      results: (current?.results ?? []).filter((r) => r.result.taskId !== result.taskId),
    }));
  }
  async function redeliver(agentId: string, principal: Principal, taskId: string) {
    const pending = (await store.read<Undelivered>(undeliveredKey(agentId)))?.results.find((r) => r.result.taskId === taskId);
    if (pending === undefined) return;
    await onComplete(pending.result, { agentId, principal, kind: pending.kind });
    await store.update<Undelivered>(undeliveredKey(agentId), (current) => ({
      results: (current?.results ?? []).filter((r) => r.result.taskId !== taskId),
    }));
  }

  // Rules, with the check-in rule added for this type's own heartbeat.
  const rules: TriggerRuleMap = { ...(definition.rules ?? {}) };
  if (definition.checkIn !== undefined) {
    const checkIn = definition.checkIn;
    type CheckInDetail = { agentType?: string; date?: string; slot?: string; nextAt?: string };
    const rule: TriggerRule<CheckInDetail> = {
      kind: CHECK_IN_KIND,
      agents: async ({ detail }) => (detail?.agentType === name ? [...(await checkIn.agents())] : []),
      oncePer: (d) => (d.date && d.slot ? `${name}:${d.date}-${d.slot}` : undefined),
      delay: humanDelay<CheckInDetail>(checkIn.profile ?? 'routine', { deadline: (d) => d.nextAt }),
      request: () => checkIn.request ?? 'Check in: review your open goals and anything you said you would do. Doing nothing is a fine answer.',
      payload: ({ detail }) => ({ date: detail.date, slot: detail.slot }),
    };
    const existing = rules[AGENT_CHECK_IN_DETAIL_TYPE];
    rules[AGENT_CHECK_IN_DETAIL_TYPE] =
      existing === undefined ? rule : [...(Array.isArray(existing) ? existing : [existing as TriggerRule<any>]), rule];
  }
  for (const [detailType, found] of Object.entries(rules)) {
    for (const rule of Array.isArray(found) ? found : [found as TriggerRule<any>]) {
      if (definition.tasks[rule.kind] === undefined)
        throw new Error(`definePersistentAgent(${name}): rule for "${detailType}" requests kind "${rule.kind}", which has no task handler`);
    }
  }

  async function route(event: TriggerEvent): Promise<TriggerDecision[]> {
    if (await isPaused()) {
      definition.log?.({ agentType: name, eventId: event.id, detailType: event['detail-type'], decision: 'paused' });
      return [];
    }
    return routeTrigger(
      {
        rules,
        gates,
        pacing: async (agentId) => (await definition.profile(agentId))?.pacing ?? null,
        principal: principalOf,
        dispatch,
        responseDelays: definition.responseDelays ?? true,
        now: clock,
        ...(definition.log ? { log: (d) => definition.log?.({ agentType: name, ...d }) } : {}),
      },
      event,
    );
  }

  async function handleTask(detail: TaskRequestDetail): Promise<AgentTaskResult> {
    const taskId = detail?.taskId;
    const fail = (error: string): AgentTaskResult => {
      definition.log?.({ agentType: name, taskId, decision: 'rejected', error });
      return { taskId, status: 'FAILED', error };
    };
    const trigger = detail?.trigger;
    if (!taskId || !trigger?.kind || !trigger.agentId) return fail('Run Agent Task for a persistent agent needs a trigger with kind and agentId');
    const handler = definition.tasks[trigger.kind];
    if (handler === undefined) return fail(`No task handler for kind "${trigger.kind}"`);
    const agentId = trigger.agentId;
    const principal = principalOf(agentId);
    if (detail.principal?.type !== principal.type || detail.principal?.id !== principal.id)
      return fail('The task principal does not match the agent');
    if (await isPaused()) {
      // Dropped unclaimed: nothing runs while paused, and nothing is recorded as done.
      definition.log?.({ agentType: name, agentId, taskId, decision: 'paused' });
      return { taskId, status: 'FAILED', error: 'paused' };
    }
    const profile = await definition.profile(agentId);
    if (profile === null) return fail(`Unknown ${name} agent`);

    const claim = await store.claim({ taskId, principal, request: detail.request });
    if (!claim.claimed) {
      if (claim.existing !== null && (claim.existing.status === 'COMPLETED' || claim.existing.status === 'FAILED'))
        await redeliver(agentId, principal, taskId);
      return claim.existing ?? { taskId, status: 'RUNNING' };
    }

    if (!(await admitTask(agentId, taskId))) {
      const capped: AgentTaskResult = {
        taskId,
        status: 'FAILED',
        error: `Task cap reached: at most ${cap?.max} tasks per ${Math.round((cap?.windowMs ?? 0) / 60_000)} minutes for one ${name} agent`,
      };
      definition.log?.({ agentType: name, agentId, taskId, decision: 'task_cap' });
      await settle(capped, { agentId, principal, kind: trigger.kind });
      return capped;
    }

    const now = clock();
    const at = now.toISOString();
    const scope = definition.scope?.(agentId, profile.persona);
    const key = (doc: string): PersistentStateKey => ({ agentId, name: `${name}.${doc}`, ...(scope ? { scope } : {}) });
    const payload = trigger.payload ?? {};
    let result: AgentTaskResult;
    try {
      const agenda = (await store.read<Agenda<N>>(key('agenda'))) ?? emptyAgenda<N>();
      const commitments = await store.update<CommitmentBook<I, F>>(
        key('commitments'),
        (current) => expireCommitments(current ?? emptyCommitments<I, F>(), at, climits).book,
      );
      const commitmentId = typeof payload.commitmentId === 'string' ? payload.commitmentId : null;

      const sendFollowUp = async (followUpId: string, input: Omit<PersistentFollowUp, 'key'>) => {
        const delayMs = Math.max(0, input.delayMs ?? 0);
        await dispatch({
          taskId: followUpId,
          agentId,
          principal,
          request: input.request,
          trigger: {
            kind: input.kind,
            agentId,
            eventId: taskId,
            detailType: FOLLOW_UP_DETAIL_TYPE,
            ...(input.payload === undefined ? {} : { payload: input.payload }),
          },
          delayMs,
          runAt: new Date(clock().getTime() + delayMs),
        });
      };
      const requireHandler = (kind: string) => {
        if (definition.tasks[kind] === undefined) throw new Error(`No task handler for follow-up kind "${kind}"`);
      };

      const ctx: PersistentTaskContext<P, N, I, F> = {
        agentType: name,
        agentId,
        persona: profile.persona,
        principal,
        taskId,
        kind: trigger.kind,
        request: detail.request,
        trigger,
        payload,
        now,
        scope,
        agenda,
        commitments,
        commitment: commitmentId === null ? null : (commitments.commitments.find((c) => c.id === commitmentId) ?? null),
        agendaLines: (describe) => agendaLines(agenda, describe),
        async updateCommitments(update) {
          const next = await store.update<CommitmentBook<I, F>>(key('commitments'), (current) => update(current ?? emptyCommitments<I, F>()));
          ctx.commitments = next;
          if (commitmentId !== null) ctx.commitment = next.commitments.find((c) => c.id === commitmentId) ?? null;
          return next;
        },
        async advanceCommitment(id, event) {
          let applied = false;
          await ctx.updateCommitments((book) => {
            const r = advanceCommitment(book, id, event, clock().toISOString(), climits);
            applied = r.applied;
            return r.book;
          });
          return applied;
        },
        async promise(input) {
          requireHandler(input.kind);
          const { request, payload: extra, delayMs, ...draft } = input;
          const followUpId = taskIdFor(`promise:${draft.source.ref}`, agentId, draft.kind);
          let outcome = 'invalid' as OpenOutcome;
          await ctx.updateCommitments((book) => {
            const r = openCommitment(book, { ...draft, at: clock().toISOString(), taskId: followUpId }, climits);
            outcome = r.outcome;
            return r.book;
          });
          if (outcome === 'created')
            await sendFollowUp(followUpId, {
              kind: draft.kind,
              request,
              payload: { ...(extra ?? {}), commitmentId: `${draft.kind}:${draft.source.ref}` },
              ...(delayMs === undefined ? {} : { delayMs }),
            });
          return outcome;
        },
        async followUp(input) {
          requireHandler(input.kind);
          const followUpId = taskIdFor(`followup:${taskId}:${input.key}`, agentId, input.kind);
          await sendFollowUp(followUpId, input);
          return followUpId;
        },
        dueCommitments: (materialChange) => dueCommitments(ctx.commitments, clock().toISOString(), materialChange, climits),
        async redispatch(commitment, mode, request) {
          requireHandler(commitment.kind);
          const followUpId = taskIdFor(`${mode}:${commitment.id}:${commitment.childTaskIds.length}`, agentId, commitment.kind);
          const applied = await ctx.advanceCommitment(commitment.id, { type: 'redispatch', taskId: followUpId, mode });
          if (applied) await sendFollowUp(followUpId, { kind: commitment.kind, request, payload: { commitmentId: commitment.id } });
          return applied;
        },
      };

      const returned = await handler(ctx);
      const output = typeof returned === 'string' ? returned : returned.output;

      if (definition.observe !== undefined) {
        // Observation never fails the task: the next one reconciles again.
        try {
          const observedAt = clock().toISOString();
          const observation = await definition.observe(ctx);
          if (observation !== null)
            await store.update<Agenda<N>>(key('agenda'), (current) =>
              reconcileAgenda(
                current ?? emptyAgenda<N>(),
                {
                  at: observedAt,
                  taskId,
                  needs: observation.needs,
                  ...(observation.epoch === undefined ? {} : { epoch: observation.epoch }),
                  ...(observation.closed === undefined ? {} : { closed: observation.closed }),
                },
                alimits,
              ),
            );
        } catch (err) {
          definition.log?.({ agentType: name, agentId, taskId, decision: 'observe_failed', error: message(err) });
        }
      }
      result = { taskId, status: 'COMPLETED', output };
    } catch (err) {
      if (isRetryable(err)) {
        // Give the claim back (FAILED is claimable again) and fail the invocation, so the platform
        // delivers this task again. No completion is announced: this is not the final outcome.
        await store.finish({ taskId, status: 'FAILED', error: `Retrying: ${message(err)}` });
        definition.log?.({ agentType: name, agentId, taskId, decision: 'retry', error: message(err) });
        throw err;
      }
      result = { taskId, status: 'FAILED', error: message(err) };
    }
    await settle(result, { agentId, principal, kind: trigger.kind });
    return result;
  }

  function checkInEvent(now: Date = clock()) {
    const moment = checkInMoment(now, schedule);
    return {
      Source: source,
      DetailType: AGENT_CHECK_IN_DETAIL_TYPE,
      Detail: JSON.stringify({
        agentType: name,
        date: moment.date,
        slot: moment.slot,
        at: moment.at.toISOString(),
        nextAt: moment.nextAt.toISOString(),
      }),
      ...bus,
    };
  }

  return {
    name,
    source,
    rules,
    route,
    handleTask,
    checkInEvent,
    async emitCheckIn(now?: Date) {
      await putEvents([checkInEvent(now)]);
    },
  };
}
