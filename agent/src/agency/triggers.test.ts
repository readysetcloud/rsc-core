import { describe, it, expect, vi, beforeEach } from 'vitest';

const ddbSend = vi.fn();
const ebSend = vi.fn();
vi.mock('../aws/ddb.js', () => ({ ddb: { send: ddbSend }, requireTableName: (t?: string) => t ?? 'test-table', TABLE_NAME: 'test-table' }));
vi.mock('../aws/events.js', () => ({ eventBridge: { send: ebSend } }));

const { routeTrigger, memoryTriggerGates, dynamoTriggerGates, eventBridgeDispatcher, taskIdFor, humanDelay, cooldownSlot } = await import('./triggers.js');
type TriggerDispatch = import('./triggers.js').TriggerDispatch;
type TriggerRuleMap = import('./triggers.js').TriggerRuleMap;

const now = new Date('2026-10-07T12:00:00Z');
const conflict = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

type Offer = { toAgent: string; offerId: string; expiresAt: string };
type Window = { date: string };

const rules: TriggerRuleMap = {
  'Offer Made': {
    kind: 'review_offer',
    agents: ({ detail }: { detail: Offer }) => [detail.toAgent],
    request: ({ detail }: { detail: Offer }) => `Review offer ${detail.offerId}`,
    payload: ({ detail }: { detail: Offer }) => ({ offerId: detail.offerId }),
    delay: humanDelay<Offer>('considered', { deadline: (d) => d.expiresAt }),
  },
  'Deadline Near': {
    kind: 'review_offer',
    urgent: true,
    agents: () => ['a1'],
    request: () => 'Decide now',
  },
  'Window Opened': [
    {
      kind: 'scout',
      agents: () => ['a1', 'a2'],
      oncePer: (d: Window) => d.date,
      request: () => 'Scout',
    },
    {
      kind: 'post',
      agents: () => ['a1', 'a2'],
      cooldown: { slot: 'chat', ms: 60_000 },
      sharedCooldown: { key: (d: Window) => d.date, ms: 60_000 },
      admit: ({ agentId }: { agentId: string }) => (agentId === 'a2' ? 'quiet' : null),
      request: () => 'Say something',
    },
  ],
};

function deps(overrides: Partial<Parameters<typeof routeTrigger>[0]> = {}) {
  const sent: TriggerDispatch[] = [];
  const gates = memoryTriggerGates();
  const d = {
    rules,
    gates,
    pacing: (id: string) => (id === 'ghost' ? null : { cooldownMs: 10 * 60_000, responseDelay: { multiplier: 1, immediateChance: 0 } }),
    principal: (id: string) => ({ type: 'system' as const, id }),
    dispatch: async (t: TriggerDispatch) => { sent.push(t); },
    now: () => now,
    ...overrides,
  };
  return { d, sent, gates };
}

const event = (type: string, detail: unknown, id = 'evt-1') => ({ id, 'detail-type': type, source: 'app', detail });

describe('routeTrigger', () => {
  it('requests a task per concerned agent, with a deterministic id and the trigger', async () => {
    const { d, sent } = deps();
    const decisions = await routeTrigger(d, event('Offer Made', { toAgent: 'a1', offerId: 'o1', expiresAt: '2026-10-08T12:00:00Z' }));
    const taskId = taskIdFor('evt-1', 'a1', 'review_offer');
    expect(decisions).toEqual([{ agentId: 'a1', kind: 'review_offer', decision: 'requested', taskId, delayMs: 0 }]);
    expect(sent[0]).toMatchObject({
      taskId,
      agentId: 'a1',
      principal: { type: 'system', id: 'a1' },
      request: 'Review offer o1',
      trigger: { kind: 'review_offer', eventId: 'evt-1', detailType: 'Offer Made', payload: { offerId: 'o1' } },
      delayMs: 0,
    });
    expect(taskIdFor('evt-1', 'a1', 'review_offer')).toBe(taskId);
    expect(taskIdFor('evt-2', 'a1', 'review_offer')).not.toBe(taskId);
  });

  it('ignores events with no rule, from other sources, and agents without pacing', async () => {
    const { d, sent } = deps({ sources: ['app'] });
    expect(await routeTrigger(d, event('Nothing', {}))).toEqual([]);
    expect(await routeTrigger(d, { ...event('Offer Made', { toAgent: 'a1', offerId: 'o', expiresAt: '' }), source: 'other' })).toEqual([]);
    expect(await routeTrigger(d, event('Offer Made', { toAgent: 'ghost', offerId: 'o', expiresAt: '' }))).toEqual([{ agentId: 'ghost', kind: 'review_offer', decision: 'unknown_agent' }]);
    expect(sent).toEqual([]);
  });

  it('spends the agent cooldown; a redelivery passes its own gate; urgent bypasses it', async () => {
    const { d, sent } = deps();
    const offer = { toAgent: 'a1', offerId: 'o1', expiresAt: '2026-10-08T12:00:00Z' };
    await routeTrigger(d, event('Offer Made', offer, 'evt-1'));
    expect((await routeTrigger(d, event('Offer Made', { ...offer, offerId: 'o2' }, 'evt-2')))[0]?.decision).toBe('cooldown');
    expect((await routeTrigger(d, event('Offer Made', offer, 'evt-1')))[0]?.decision).toBe('requested');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.taskId).toBe(sent[0]?.taskId);
    expect((await routeTrigger(d, event('Deadline Near', {}, 'evt-3')))[0]?.decision).toBe('requested');
    // After the window the slot opens again.
    const later = deps({ gates: d.gates, now: () => new Date(now.getTime() + 11 * 60_000) });
    expect((await routeTrigger(later.d, event('Offer Made', offer, 'evt-4')))[0]?.decision).toBe('requested');
  });

  it('fires a oncePer rule once per key, and a shared cooldown once per key per window', async () => {
    const { d, sent } = deps();
    const first = await routeTrigger(d, event('Window Opened', { date: '2026-10-07' }, 'w1'));
    expect(first.map((x) => [x.kind, x.agentId, x.decision])).toEqual([
      ['scout', 'a1', 'requested'],
      ['scout', 'a2', 'requested'],
      ['post', 'a1', 'requested'],
      ['post', 'a2', 'declined'],
    ]);
    expect(first.find((x) => x.kind === 'post' && x.agentId === 'a2')).toMatchObject({ reason: 'quiet' });
    const again = await routeTrigger(d, event('Window Opened', { date: '2026-10-07' }, 'w2'));
    expect(again.map((x) => [x.kind, x.decision])).toEqual([
      ['scout', 'repeat'],
      ['scout', 'repeat'],
      ['post', 'shared_cooldown'],
      ['post', 'shared_cooldown'],
    ]);
    // A new key passes the once-per and shared gates, but the agents' own cooldowns still hold...
    const sameMinute = await routeTrigger(d, event('Window Opened', { date: '2026-10-08' }, 'w3'));
    expect(sameMinute.map((x) => x.decision)).toEqual(['cooldown', 'cooldown', 'cooldown', 'declined']);
    // ...until their windows pass.
    const later = deps({ gates: d.gates, now: () => new Date(now.getTime() + 11 * 60_000) });
    const nextDay = await routeTrigger({ ...later.d, dispatch: d.dispatch }, event('Window Opened', { date: '2026-10-09' }, 'w4'));
    expect(nextDay.filter((x) => x.decision === 'requested')).toHaveLength(3);
    expect(sent.filter((t) => t.trigger.kind === 'scout')).toHaveLength(4);
    expect(cooldownSlot('a1', { kind: 'post' }, { slot: 'chat' })).toBe('a1#chat');
  });

  it('delays only when response delays are on, clamped to the deadline', async () => {
    const { d, sent } = deps({ responseDelays: true });
    const expiresAt = new Date(now.getTime() + 60 * 60_000).toISOString();
    const [decision] = await routeTrigger(d, event('Offer Made', { toAgent: 'a1', offerId: 'o1', expiresAt }));
    expect(decision).toMatchObject({ decision: 'requested' });
    expect(sent[0]!.delayMs).toBeGreaterThan(0);
    expect(sent[0]!.delayMs).toBeLessThanOrEqual(30 * 60_000);
    expect(sent[0]!.runAt.getTime()).toBe(now.getTime() + sent[0]!.delayMs);
  });

  it('logs every decision', async () => {
    const log = vi.fn();
    const { d } = deps({ log });
    await routeTrigger(d, event('Offer Made', { toAgent: 'a1', offerId: 'o1', expiresAt: '' }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-1', detailType: 'Offer Made', decision: 'requested' }));
  });
});

describe('dynamoTriggerGates', () => {
  beforeEach(() => ddbSend.mockReset());

  it('takes a windowed slot conditionally and reports a closed one', async () => {
    const gates = dynamoTriggerGates({ prefix: 'league-1' });
    ddbSend.mockResolvedValueOnce({});
    expect(await gates.admit({ slot: 'a1#reply', owner: 't1', now, windowMs: 120_000 })).toBe(true);
    const input = ddbSend.mock.calls[0][0].input;
    expect(input.Key).toEqual({ pk: 'TRIGGER#league-1#a1#reply', sk: 'GATE' });
    expect(input.ConditionExpression).toBe('attribute_not_exists(pk) OR #owner = :owner OR lastTriggeredAt <= :cutoff');
    expect(input.ExpressionAttributeValues[':cutoff']).toBe('2026-10-07T11:58:00.000Z');
    ddbSend.mockRejectedValueOnce(conflict());
    expect(await gates.admit({ slot: 'a1#reply', owner: 't2', now, windowMs: 120_000 })).toBe(false);
  });

  it('a once-per key never reopens; an urgent gate has no condition', async () => {
    const gates = dynamoTriggerGates();
    ddbSend.mockResolvedValue({});
    await gates.admit({ slot: 'rule#scout#2026-10-07', owner: 'e1', now, windowMs: null });
    expect(ddbSend.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(pk) OR #owner = :owner');
    await gates.admit({ slot: 'a1#review', owner: 't1', now, windowMs: 0 });
    expect(ddbSend.mock.calls[1][0].input.ConditionExpression).toBeUndefined();
    ddbSend.mockRejectedValueOnce(new Error('boom'));
    await expect(gates.admit({ slot: 'x', owner: 'y', now, windowMs: 1 })).rejects.toThrow('boom');
  });

  it('releases only the owner’s slot', async () => {
    const gates = dynamoTriggerGates();
    ddbSend.mockResolvedValueOnce({});
    expect(await gates.release('a1#reply', 't1')).toBe(true);
    expect(ddbSend.mock.calls[0][0].input).toMatchObject({ Key: { pk: 'TRIGGER#a1#reply', sk: 'GATE' }, ConditionExpression: '#owner = :owner' });
    ddbSend.mockRejectedValueOnce(conflict());
    expect(await gates.release('a1#reply', 't2')).toBe(false);
  });
});

describe('memoryTriggerGates', () => {
  it('releases only the owner’s slot', async () => {
    const gates = memoryTriggerGates();
    await gates.admit({ slot: 's', owner: 'o1', now, windowMs: 1000 });
    expect(await gates.release('s', 'o2')).toBe(false);
    expect(await gates.release('s', 'o1')).toBe(true);
    expect(gates.state.size).toBe(0);
  });
});

describe('eventBridgeDispatcher', () => {
  beforeEach(() => { ebSend.mockReset(); ebSend.mockResolvedValue({}); });
  const task: TriggerDispatch = {
    taskId: 'review_offer.abc.def',
    agentId: 'a1',
    principal: { type: 'system', id: 'a1' },
    request: 'Review offer o1',
    trigger: { kind: 'review_offer', eventId: 'evt-1', detailType: 'Offer Made', payload: { offerId: 'o1' } },
    delayMs: 0,
    runAt: now,
  };

  it('publishes a Run Agent Task at once, with the host defaults and session', async () => {
    const dispatch = eventBridgeDispatcher({ eventBusName: 'bus', defaults: { modelId: 'm1', tools: ['t'] }, sessionId: (t) => `agent-${t.agentId}` });
    await dispatch(task);
    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry).toMatchObject({ Source: 'readysetcloud.agent', DetailType: 'Run Agent Task', EventBusName: 'bus' });
    expect(JSON.parse(entry.Detail)).toEqual({
      taskId: task.taskId,
      principal: task.principal,
      request: task.request,
      trigger: task.trigger,
      sessionId: 'agent-a1',
      modelId: 'm1',
      tools: ['t'],
    });
  });

  it('schedules a delayed task through Schedule Event, named by the task id', async () => {
    const dispatch = eventBridgeDispatcher();
    await dispatch({ ...task, delayMs: 5000, runAt: new Date(now.getTime() + 5000) });
    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry).toMatchObject({ Source: 'readysetcloud.agent', DetailType: 'Schedule Event' });
    expect(entry.EventBusName).toBeUndefined();
    const detail = JSON.parse(entry.Detail);
    expect(detail).toMatchObject({ name: task.taskId, at: '2026-10-07T12:00:05.000Z', whenPast: 'send' });
    expect(detail.event).toMatchObject({ source: 'readysetcloud.agent', detailType: 'Run Agent Task', detail: { taskId: task.taskId, trigger: task.trigger } });
  });
});
