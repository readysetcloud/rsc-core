import { DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ddb, requireTableName } from '../aws/ddb.js';
import { eventBridge } from '../aws/events.js';
import { TASK_EVENT_SOURCE, TASK_REQUEST_DETAIL_TYPE, type TaskRequestDetail, type TaskTrigger } from '../memory/task-events.js';
import type { Principal } from '../memory/tasks.js';
import { hashString } from './random.js';
import { responseDelay, IMMEDIATE_RESPONSE, type ResponseDelayInput, type ResponseDelayLever } from './response-delay.js';

// The trigger router: how events become an agent's reasons to act.
//
// An agent with agency does not run on every event that reaches the bus. A
// rule per event type says which agents the event concerns, what kind of task
// it calls for, and how the agent should pace itself: a cooldown so one agent
// is not woken for the same kind of work twice in a minute, a once-per key so a
// recurring event (a daily window, a scheduled check-in) wakes it once, a
// human-like delay so it does not answer the instant something lands, and
// `urgent` for deadlines that bypass all of that. Every gate is an atomic
// conditional write owned by what passed it, so two deliveries racing for one
// gate cannot both pass, while a redelivery of the same event passes its own
// gates again and lands on the same deterministic task id, where the task
// runner's claim (`startTask`) makes the second delivery a no-op.
//
// The output is a "Run Agent Task" request per (event, agent, kind), carrying a
// `trigger` the task reads. The default dispatcher publishes it at once, or
// hands it to the "Schedule Event" primitive (rsc-core) when it should wait.

/** The event envelope the router reads (EventBridge's shape, with the fields it needs). */
export interface TriggerEvent<D = unknown> {
  id: string;
  'detail-type': string;
  source?: string;
  time?: string;
  detail: D;
}

/** How an agent paces itself: its baseline cooldown and its response-delay temperament. */
export interface AgentPacing {
  /** Minimum time between two non-urgent tasks of one kind for this agent. */
  cooldownMs: number;
  responseDelay: ResponseDelayLever;
}

/** A rule's view of one agent the event may concern. */
export interface RuleAgentInput<D> {
  detail: D;
  event: TriggerEvent<D>;
  agentId: string;
  pacing: AgentPacing;
  now: Date;
}

export interface RuleDelayInput<D> extends RuleAgentInput<D> {
  /** The agent's place among the agents this event concerns (for staggering). */
  index: number;
}

export interface TriggerRule<D = unknown> {
  /** The task kind this rule requests; also the agent's default cooldown slot. */
  kind: string;
  /** Which agents the event concerns. An empty list routes nowhere. */
  agents(input: { detail: D; event: TriggerEvent<D>; now: Date }): readonly string[] | Promise<readonly string[]>;
  /** The instruction the task runs, for one agent. */
  request(input: RuleAgentInput<D>): string;
  /** Fields the task needs (ids, deadlines), never the event's untrusted text. */
  payload?(input: RuleAgentInput<D>): Record<string, unknown>;
  /** Bypasses cooldowns and delays (a deadline), but still starts the cooldown. */
  urgent?: boolean;
  /**
   * Fire at most once per key, across every delivery and every event with the same key (a daily
   * window keyed by its date). Undefined means no such limit.
   */
  oncePer?(detail: D): string | undefined;
  /**
   * The agent's cooldown for this rule instead of its baseline: a slot name shared by the kinds
   * that should pace together (every chat kind), and the window.
   */
  cooldown?: { slot: string; ms: number } | ((detail: D) => { slot: string; ms: number });
  /** A cooldown shared by every agent the rule reaches, keyed by the event (one reaction per moment). */
  sharedCooldown?: { key(detail: D): string | undefined; ms: number };
  /** A per-agent gate before the cooldown: null admits; a string is the decision logged instead. */
  admit?(input: RuleAgentInput<D>): Promise<string | null> | string | null;
  /** Milliseconds the agent waits before the task runs (`humanDelay` builds the usual one). */
  delay?(input: RuleDelayInput<D>): number;
}

/** The task the router hands the dispatcher. */
export interface TriggerDispatch {
  taskId: string;
  agentId: string;
  principal: Principal;
  request: string;
  trigger: TaskTrigger;
  /** How long to wait before the task runs; 0 runs it now. */
  delayMs: number;
  /** When it runs (`now + delayMs`). */
  runAt: Date;
}

export type TriggerDecision =
  | { agentId: string; kind: string; decision: 'requested'; taskId: string; delayMs: number }
  | { agentId: string; kind: string; decision: 'repeat' | 'cooldown' | 'shared_cooldown' | 'unknown_agent' | 'no_rule'; reason?: string }
  | { agentId: string; kind: string; decision: 'declined'; reason: string };

/**
 * A gate on a named slot: taken by `owner` when the slot is free, already the owner's (a
 * redelivery gets the same answer), or last taken at least `windowMs` ago (null: never again, a
 * once-per key; 0: always, as urgent triggers do). Taking it records `now` and the owner, atomically.
 */
export interface TriggerGate {
  slot: string;
  owner: string;
  now: Date;
  windowMs: number | null;
}

export interface TriggerGates {
  admit(gate: TriggerGate): Promise<boolean>;
  /** Gives a slot back, if `owner` holds it. */
  release(slot: string, owner: string): Promise<boolean>;
}

/** The cutoff before which a slot last taken counts as free again. */
export function gateCutoff(gate: TriggerGate & { windowMs: number }): string {
  return new Date(gate.now.getTime() - gate.windowMs).toISOString();
}

/**
 * Gates in DynamoDB: one item per slot (`pk=TRIGGER#{slot}`, `sk=GATE`), taken by a conditional
 * update. Slots are namespaced by the caller (`agent-1#reply`); use a `prefix` to keep several
 * routers apart in one table.
 */
export function dynamoTriggerGates(options: { tableName?: string; prefix?: string; ttlMs?: number } = {}): TriggerGates {
  const key = (slot: string) => ({ pk: `TRIGGER#${options.prefix ? `${options.prefix}#` : ''}${slot}`, sk: 'GATE' });
  const TableName = () => requireTableName(options.tableName);
  const ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60_000;
  return {
    async admit(gate) {
      const update = {
        TableName: TableName(),
        Key: key(gate.slot),
        UpdateExpression: 'SET entity = :entity, slot = :slot, lastTriggeredAt = :now, #owner = :owner, expiresAt = :ttl',
        ExpressionAttributeNames: { '#owner': 'owner' },
        ExpressionAttributeValues: {
          ':entity': 'TriggerGate',
          ':slot': gate.slot,
          ':now': gate.now.toISOString(),
          ':owner': gate.owner,
          ':ttl': Math.floor((gate.now.getTime() + ttlMs) / 1000),
        },
      };
      const command =
        gate.windowMs === 0
          ? new UpdateCommand(update)
          : new UpdateCommand({
              ...update,
              ConditionExpression: `attribute_not_exists(pk) OR #owner = :owner${gate.windowMs === null ? '' : ' OR lastTriggeredAt <= :cutoff'}`,
              ExpressionAttributeValues: {
                ...update.ExpressionAttributeValues,
                ...(gate.windowMs === null ? {} : { ':cutoff': gateCutoff({ ...gate, windowMs: gate.windowMs }) }),
              },
            });
      try {
        await ddb.send(command);
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
    async release(slot, owner) {
      try {
        await ddb.send(new DeleteCommand({
          TableName: TableName(),
          Key: key(slot),
          ConditionExpression: '#owner = :owner',
          ExpressionAttributeNames: { '#owner': 'owner' },
          ExpressionAttributeValues: { ':owner': owner },
        }));
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
  };
}

/** Gates in memory, with the same semantics: for tests, local dev, and single-process hosts. */
export function memoryTriggerGates(): TriggerGates & { state: Map<string, { lastTriggeredAt: string; owner: string }> } {
  const state = new Map<string, { lastTriggeredAt: string; owner: string }>();
  return {
    state,
    async admit(gate) {
      const current = state.get(gate.slot);
      const open =
        current === undefined ||
        current.owner === gate.owner ||
        gate.windowMs === 0 ||
        (gate.windowMs !== null && current.lastTriggeredAt <= gateCutoff({ ...gate, windowMs: gate.windowMs }));
      if (!open) return false;
      state.set(gate.slot, { lastTriggeredAt: gate.now.toISOString(), owner: gate.owner });
      return true;
    },
    async release(slot, owner) {
      if (state.get(slot)?.owner !== owner) return false;
      return state.delete(slot);
    },
  };
}

/** Stable, short task id for (event, agent, kind): a redelivered event lands on the same task. */
export function taskIdFor(eventId: string, agentId: string, kind: string): string {
  return `${kind}.${hashString(`${eventId}|${agentId}`).toString(36)}.${hashString(`${agentId}|${eventId}|${kind}`).toString(36)}`;
}

/** The agent's cooldown slot for a rule: one per agent and kind unless the rule names a shared slot. */
export function cooldownSlot(agentId: string, rule: { kind: string }, cooldown?: { slot: string }): string {
  return `${agentId}#${cooldown?.slot ?? rule.kind}`;
}

/**
 * The usual `delay` for a rule: the agent's response-delay temperament over a profile, clamped to
 * a deadline the event carries. With `responseDelays` off on the router, every delay is 0.
 */
export function humanDelay<D>(
  profile: ResponseDelayInput['profile'],
  options: { deadline?: (detail: D) => Date | string | null | undefined } = {},
): (input: RuleDelayInput<D>) => number {
  return (input) =>
    responseDelay({
      profile,
      seed: `${input.event.id}:${input.agentId}`,
      lever: input.pacing.responseDelay,
      now: input.now,
      deadline: options.deadline?.(input.detail) ?? null,
    }).delayMs;
}

/** Rules by event `detail-type`: one, or several (an event that calls for two kinds of work). */
export type TriggerRuleMap = Record<string, TriggerRule<any> | readonly TriggerRule<any>[]>;

export interface TriggerRouterDeps {
  rules: TriggerRuleMap;
  gates: TriggerGates;
  /** The agent's pacing, or null when the id is not an agent this router runs (it is skipped). */
  pacing(agentId: string): Promise<AgentPacing | null> | AgentPacing | null;
  /** The principal the agent's tasks run as. */
  principal(agentId: string): Principal;
  /** Sends the task; `eventBridgeDispatcher` is the usual one. */
  dispatch(task: TriggerDispatch): Promise<void>;
  /** Human-like delays on (production) or off (tests, local dev, replays): default off. */
  responseDelays?: boolean;
  /** Only events from these sources are triggers; others are ignored. Default: any source. */
  sources?: readonly string[];
  now?(): Date;
  log?: (decision: TriggerDecision & { eventId: string; detailType: string }) => void;
}

/**
 * Routes one event through every rule for its type and returns the decisions, one per agent a
 * rule concerned. Gates, in order: the rule's `oncePer` key, its shared cooldown, then per agent
 * its `admit`, its cooldown slot, and the dispatch.
 */
export async function routeTrigger(deps: TriggerRouterDeps, event: TriggerEvent): Promise<TriggerDecision[]> {
  if (deps.sources !== undefined && (event.source === undefined || !deps.sources.includes(event.source))) return [];
  const found = deps.rules[event['detail-type']];
  const rules: TriggerRule<any>[] = found === undefined ? [] : Array.isArray(found) ? [...found] : [found as TriggerRule<any>];
  const decisions: TriggerDecision[] = [];
  for (const rule of rules) decisions.push(...(await routeRule(deps, event, rule)));
  return decisions;
}

async function routeRule(deps: TriggerRouterDeps, event: TriggerEvent, rule: TriggerRule<any>): Promise<TriggerDecision[]> {
  const now = deps.now?.() ?? new Date();
  const detail = event.detail ?? {};
  const agents = [...new Set(await rule.agents({ detail, event, now }))];
  const decisions: TriggerDecision[] = [];
  const record = (d: TriggerDecision) => {
    decisions.push(d);
    deps.log?.({ ...d, eventId: event.id, detailType: event['detail-type'] });
  };
  if (agents.length === 0) return decisions;

  const onceKey = rule.oncePer?.(detail);
  if (onceKey !== undefined) {
    const admitted = await deps.gates.admit({ slot: `rule#${rule.kind}#${onceKey}`, owner: event.id, now, windowMs: null });
    if (!admitted) {
      for (const agentId of agents) record({ agentId, kind: rule.kind, decision: 'repeat' });
      return decisions;
    }
  }
  const sharedKey = rule.sharedCooldown?.key(detail);
  if (rule.sharedCooldown !== undefined && sharedKey !== undefined) {
    const admitted = await deps.gates.admit({ slot: `rule#${rule.kind}#shared#${sharedKey}`, owner: event.id, now, windowMs: rule.sharedCooldown.ms });
    if (!admitted) {
      for (const agentId of agents) record({ agentId, kind: rule.kind, decision: 'shared_cooldown' });
      return decisions;
    }
  }

  const cooldown = typeof rule.cooldown === 'function' ? rule.cooldown(detail) : rule.cooldown;
  for (const [index, agentId] of agents.entries()) {
    const base = { agentId, kind: rule.kind };
    const pacing = await deps.pacing(agentId);
    if (pacing === null) {
      record({ ...base, decision: 'unknown_agent' });
      continue;
    }
    const input: RuleAgentInput<any> = { detail, event, agentId, pacing, now };
    const turnedAway = rule.admit === undefined ? null : await rule.admit(input);
    if (turnedAway !== null) {
      record({ ...base, decision: 'declined', reason: turnedAway });
      continue;
    }
    const taskId = taskIdFor(event.id, agentId, rule.kind);
    const windowMs = rule.urgent ? 0 : (cooldown?.ms ?? pacing.cooldownMs);
    const admitted = await deps.gates.admit({ slot: cooldownSlot(agentId, rule, cooldown), owner: taskId, now, windowMs });
    if (!admitted) {
      record({ ...base, decision: 'cooldown' });
      continue;
    }
    const delayMs =
      rule.urgent || rule.delay === undefined
        ? 0
        : Math.max(
            0,
            rule.delay({
              ...input,
              index,
              pacing: deps.responseDelays === true ? pacing : { ...pacing, responseDelay: IMMEDIATE_RESPONSE },
            }),
          );
    const payload = rule.payload?.(input);
    await deps.dispatch({
      taskId,
      agentId,
      principal: deps.principal(agentId),
      request: rule.request(input),
      trigger: {
        kind: rule.kind,
        eventId: event.id,
        detailType: event['detail-type'],
        ...(payload === undefined ? {} : { payload }),
        ...(rule.urgent ? { urgent: true } : {}),
      },
      delayMs,
      runAt: new Date(now.getTime() + delayMs),
    });
    record({ ...base, decision: 'requested', taskId, delayMs });
  }
  return decisions;
}

export interface EventBridgeDispatcherOptions {
  /** Bus to publish on; defaults to the account's `default` bus. */
  eventBusName?: string;
  /** `source` of the "Schedule Event" request a delayed task becomes (default: the task source). */
  scheduleSource?: string;
  /** Per-task overrides a host wants on every routed task (a system prompt, a model, named tools). */
  defaults?: Pick<TaskRequestDetail, 'systemPrompt' | 'modelId' | 'temperature' | 'maxTokens' | 'tools' | 'mcpServers'>;
  /** A session per agent, so routed tasks keep continuity: return undefined for one-shot tasks. */
  sessionId?(task: TriggerDispatch): string | undefined;
}

/**
 * Dispatches a routed task as a "Run Agent Task" event: published at once, or, when it should
 * wait, wrapped in a "Schedule Event" request named by the task id (rsc-core's deferred-event
 * primitive moves a schedule re-emitted under the same name rather than doubling it, so a
 * redelivered trigger neither delays nor duplicates the task).
 */
export function eventBridgeDispatcher(options: EventBridgeDispatcherOptions = {}): (task: TriggerDispatch) => Promise<void> {
  return async (task) => {
    const sessionId = options.sessionId?.(task);
    const detail: TaskRequestDetail = {
      taskId: task.taskId,
      principal: task.principal,
      request: task.request,
      trigger: task.trigger,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(options.defaults ?? {}),
    };
    const entry =
      task.delayMs > 0
        ? {
            Source: options.scheduleSource ?? TASK_EVENT_SOURCE,
            DetailType: 'Schedule Event',
            Detail: JSON.stringify({
              name: task.taskId,
              at: task.runAt.toISOString(),
              whenPast: 'send',
              event: { source: TASK_EVENT_SOURCE, detailType: TASK_REQUEST_DETAIL_TYPE, detail },
            }),
          }
        : { Source: TASK_EVENT_SOURCE, DetailType: TASK_REQUEST_DETAIL_TYPE, Detail: JSON.stringify(detail) };
    await eventBridge.send(new PutEventsCommand({
      Entries: [{ ...entry, ...(options.eventBusName ? { EventBusName: options.eventBusName } : {}) }],
    }));
  };
}
