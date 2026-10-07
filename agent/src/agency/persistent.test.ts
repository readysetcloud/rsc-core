import { describe, it, expect, vi, beforeEach } from 'vitest';

const ebSend = vi.fn();
vi.mock('../aws/events.js', () => ({ eventBridge: { send: ebSend } }));

const { definePersistentAgent, memoryAgentStore, AGENT_CHECK_IN_DETAIL_TYPE } = await import('./persistent.js');
const { memoryTriggerGates } = await import('./triggers.js');
type TriggerDispatch = import('./triggers.js').TriggerDispatch;
type TaskRequestDetail = import('../memory/task-events.js').TaskRequestDetail;
type AgentTaskResult = import('../memory/tasks.js').AgentTaskResult;

type Persona = { voice: string };
type Need = { pr: number };
type Intent = { test: string };

const pacing = { cooldownMs: 15 * 60_000, responseDelay: { multiplier: 1, immediateChance: 0 } };
const t0 = new Date('2026-10-07T18:30:00Z');

function setup(overrides: Record<string, unknown> = {}) {
  let now = t0;
  const store = memoryAgentStore();
  const gates = memoryTriggerGates();
  const sent: TriggerDispatch[] = [];
  const completed: AgentTaskResult[] = [];
  const open = new Map<string, number[]>([['rev-1', [7]]]);
  const seen: Record<string, unknown>[] = [];
  const attempts = new Map<string, number>();
  const agent = definePersistentAgent<Persona, Need, Intent>({
    name: 'reviewer',
    profile: (id) => (id.startsWith('rev-') ? { persona: { voice: 'terse' }, pacing } : null),
    rules: {
      'Pull Request Opened': {
        kind: 'review',
        agents: ({ detail }: { detail: { reviewers: string[] } }) => detail.reviewers,
        request: ({ detail }: { detail: { pr: number } }) => `Review #${detail.pr}`,
        payload: ({ detail }: { detail: { pr: number } }) => ({ pr: detail.pr }),
      },
    },
    tasks: {
      review: async (ctx) => {
        seen.push({ kind: ctx.kind, lines: ctx.agendaLines((g) => `review #${g.data.pr}`), payload: ctx.payload, persona: ctx.persona });
        if (ctx.payload.boom) throw new Error('model failed');
        const n = (attempts.get(ctx.taskId) ?? 0) + 1;
        attempts.set(ctx.taskId, n);
        if (typeof ctx.payload.throttle === 'number' && n <= ctx.payload.throttle)
          throw Object.assign(new Error('slow down'), { name: 'ThrottlingException' });
        if (ctx.payload.promise)
          await ctx.promise({
            kind: 'investigate',
            counterpart: 'user-9',
            source: { channel: 'pr-7', ref: 'comment-1', visibility: 'shared' },
            intent: { test: 'login.spec' },
            expiresAt: new Date(ctx.now.getTime() + 48 * 3600_000).toISOString(),
            request: 'Look into the flaky login spec.',
          });
        return `reviewed ${ctx.payload.pr}`;
      },
      investigate: async (ctx) => {
        seen.push({ kind: ctx.kind, commitment: ctx.commitment?.status });
        const c = ctx.commitment!;
        await ctx.advanceCommitment(c.id, { type: 'start', taskId: ctx.taskId });
        await ctx.advanceCommitment(c.id, { type: 'closed', taskId: ctx.taskId, status: 'declined', reason: 'not_reproducible', reconsider: true });
        return { output: 'looked' };
      },
      check_in: async (ctx) => {
        const due = ctx.dueCommitments(() => true);
        for (const c of due.reconsider) await ctx.redispatch(c, 'reconsider', 'Look again.');
        seen.push({ kind: ctx.kind, reconsider: due.reconsider.length, lines: ctx.agendaLines((g) => `review #${g.data.pr}`) });
        return 'checked in';
      },
    },
    observe: (ctx) => ({ needs: (open.get(ctx.agentId) ?? []).map((pr) => ({ id: `review:${pr}`, kind: 'review', data: { pr } })) }),
    checkIn: { agents: () => ['rev-1'] },
    store,
    gates,
    dispatch: async (t) => { sent.push(t); },
    onComplete: async (r) => { completed.push(r); },
    responseDelays: false,
    now: () => now,
    ...overrides,
  });
  const detailOf = (t: TriggerDispatch): TaskRequestDetail => ({ taskId: t.taskId, principal: t.principal, request: t.request, trigger: t.trigger });
  return { agent, store, sent, completed, open, seen, detailOf, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe('definePersistentAgent', () => {
  beforeEach(() => ebSend.mockReset());

  it('refuses a rule whose kind has no task handler', () => {
    expect(() =>
      definePersistentAgent({ name: 'x', profile: () => null, tasks: {}, rules: { E: { kind: 'missing', agents: () => [], request: () => '' } } }),
    ).toThrow(/kind "missing"/);
    expect(() => definePersistentAgent({ name: 'x', profile: () => null, tasks: {}, checkIn: { agents: () => [] } })).toThrow(/check_in/);
    expect(() => definePersistentAgent({ name: '', profile: () => null, tasks: {} })).toThrow(/name/);
  });

  it('routes an event to its agents with a namespaced principal and the agent on the trigger', async () => {
    const { agent, sent } = setup();
    const decisions = await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1', 'someone-else'] } });
    expect(decisions.map((d) => [d.agentId, d.decision])).toEqual([['rev-1', 'requested'], ['someone-else', 'unknown_agent']]);
    expect(sent[0]).toMatchObject({
      agentId: 'rev-1',
      principal: { type: 'system', id: 'reviewer/rev-1' },
      request: 'Review #7',
      trigger: { kind: 'review', agentId: 'rev-1', payload: { pr: 7 } },
    });
  });

  it('runs a task, reconciles the agenda from observation, and records the result once', async () => {
    const { agent, sent, completed, seen, detailOf, store, open } = setup();
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const detail = detailOf(sent[0]!);
    expect(await agent.handleTask(detail)).toEqual({ taskId: detail.taskId, status: 'COMPLETED', output: 'reviewed 7' });
    expect(seen[0]).toMatchObject({ lines: [], persona: { voice: 'terse' } });
    // A duplicate delivery returns the stored result without running the handler again.
    expect(await agent.handleTask(detail)).toMatchObject({ status: 'COMPLETED', output: 'reviewed 7' });
    expect(seen).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(store.tasks.get(detail.taskId)?.status).toBe('COMPLETED');
    // The next task sees the goal the observation opened; it completes when the need goes away.
    await agent.handleTask({ ...detail, taskId: 'manual-2' });
    expect(seen[1]).toMatchObject({ lines: [expect.stringMatching(/^\[review:7\] review #7 \(pursuing since /)] });
    open.set('rev-1', []);
    await agent.handleTask({ ...detail, taskId: 'manual-3' });
    await agent.handleTask({ ...detail, taskId: 'manual-4' });
    expect(seen[3]).toMatchObject({ lines: [] });
  });

  it('rejects malformed or mismatched tasks without claiming them', async () => {
    const { agent, store, seen } = setup();
    const base = { taskId: 't', request: 'r', principal: { type: 'system' as const, id: 'reviewer/rev-1' } };
    expect((await agent.handleTask(base)).error).toMatch(/trigger/);
    expect((await agent.handleTask({ ...base, trigger: { kind: 'nope', agentId: 'rev-1', eventId: 'e', detailType: 'x' } })).error).toMatch(/No task handler/);
    expect((await agent.handleTask({ ...base, principal: { type: 'user', id: 'mallory' }, trigger: { kind: 'review', agentId: 'rev-1', eventId: 'e', detailType: 'x' } })).error).toMatch(/principal/);
    expect((await agent.handleTask({ ...base, principal: { type: 'system', id: 'reviewer/ghost' }, trigger: { kind: 'review', agentId: 'ghost', eventId: 'e', detailType: 'x' } })).error).toMatch(/Unknown reviewer agent/);
    expect(store.tasks.size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('records a failed handler as FAILED and skips observation', async () => {
    const { agent, store, sent, detailOf } = setup();
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    const r = await agent.handleTask({ ...d, trigger: { ...d.trigger!, payload: { pr: 7, boom: true } } });
    expect(r).toMatchObject({ status: 'FAILED', error: 'model failed' });
    expect([...store.state.keys()].some((k) => k.includes('reviewer.agenda'))).toBe(false);
  });

  it('keeps a promise: records it, dispatches the owning follow-up once, and lets it decide', async () => {
    const { agent, sent, seen, detailOf, advance } = setup();
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    const withPromise = { ...d, trigger: { ...d.trigger!, payload: { pr: 7, promise: true } } };
    await agent.handleTask(withPromise);
    await agent.handleTask({ ...withPromise, taskId: 'again' }); // the same promise again: 'existing', no second follow-up
    const followUps = sent.filter((t) => t.trigger.kind === 'investigate');
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ trigger: { detailType: 'Agent Follow-Up', agentId: 'rev-1', payload: { commitmentId: 'investigate:comment-1' } } });
    await agent.handleTask(detailOf(followUps[0]!));
    expect(seen.find((s) => s.kind === 'investigate')).toMatchObject({ commitment: 'queued' });

    // Thirteen hours later a check-in finds the reconsiderable decline and hands it to a new task.
    advance(13 * 3600_000);
    const checkIn = agent.checkInEvent();
    const decisions = await agent.route({ id: 'ci-1', 'detail-type': checkIn.DetailType, detail: JSON.parse(checkIn.Detail) });
    expect(decisions).toEqual([expect.objectContaining({ agentId: 'rev-1', kind: 'check_in', decision: 'requested' })]);
    await agent.handleTask(detailOf(sent.at(-1)!));
    expect(seen.at(-1)).toMatchObject({ kind: 'check_in', reconsider: 1 });
    const again = sent.filter((t) => t.trigger.kind === 'investigate');
    expect(again).toHaveLength(2);
    expect(again[1]!.taskId).not.toBe(again[0]!.taskId);
  });

  it('builds and emits its own check-in event, once per slot, ignoring other agent types', async () => {
    const { agent, sent } = setup();
    const ev = agent.checkInEvent(t0);
    expect(ev).toMatchObject({ Source: 'agency.reviewer', DetailType: AGENT_CHECK_IN_DETAIL_TYPE });
    expect(agent.source).toBe('agency.reviewer');
    expect(JSON.parse(ev.Detail)).toMatchObject({ agentType: 'reviewer', date: '2026-10-07', slot: 'afternoon' });
    const detail = JSON.parse(ev.Detail);
    expect((await agent.route({ id: 'a', 'detail-type': ev.DetailType, detail }))[0]?.decision).toBe('requested');
    expect((await agent.route({ id: 'b', 'detail-type': ev.DetailType, detail }))[0]?.decision).toBe('repeat');
    expect(await agent.route({ id: 'c', 'detail-type': ev.DetailType, detail: { ...detail, agentType: 'other' } })).toEqual([]);
    expect(sent).toHaveLength(1);
    ebSend.mockResolvedValue({});
    await agent.emitCheckIn(t0);
    expect(ebSend.mock.calls[0][0].input.Entries[0]).toMatchObject({ DetailType: 'Agent Check-In' });
  });

  it('never uses the shared service source, and emits completions from its own', async () => {
    expect(() => setup({ source: 'readysetcloud.agent' })).toThrow(/shared service/);
    const { agent, sent, detailOf } = setup({ onComplete: undefined });
    ebSend.mockResolvedValue({});
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    await agent.handleTask(detailOf(sent[0]!));
    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry).toMatchObject({ Source: 'agency.reviewer', DetailType: 'Agent Task Completed' });
    expect(JSON.parse(entry.Detail)).toMatchObject({ status: 'COMPLETED', agentType: 'reviewer', agentId: 'rev-1', kind: 'review' });
  });

  it('rethrows a retryable error with the claim given back, so the next delivery runs it', async () => {
    const { agent, sent, detailOf, store, completed } = setup();
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    const flaky = { ...d, trigger: { ...d.trigger!, payload: { pr: 7, throttle: 1 } } };
    await expect(agent.handleTask(flaky)).rejects.toMatchObject({ name: 'ThrottlingException' });
    expect(store.tasks.get(d.taskId)).toMatchObject({ status: 'FAILED', error: 'Retrying: slow down' });
    expect(completed).toHaveLength(0);
    expect(await agent.handleTask(flaky)).toMatchObject({ status: 'COMPLETED', output: 'reviewed 7' });
    expect(completed).toHaveLength(1);
  });

  it('fails a non-retryable error for good, and honors a custom classifier', async () => {
    const { agent, sent, detailOf } = setup({ isRetryable: () => false });
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    const r = await agent.handleTask({ ...d, trigger: { ...d.trigger!, payload: { pr: 7, throttle: 1 } } });
    expect(r).toMatchObject({ status: 'FAILED', error: 'slow down' });
  });

  it('classifies retryable errors', async () => {
    const { isRetryableError } = await import('./persistent.js');
    for (const e of [{ name: 'ThrottlingException' }, { code: 'ECONNRESET' }, { $retryable: {} }, { $metadata: { httpStatusCode: 503 } }, { statusCode: 429 }, { name: 'AgentStateConflictError' }])
      expect(isRetryableError(e)).toBe(true);
    for (const e of [new Error('bug'), { name: 'ValidationException', $metadata: { httpStatusCode: 400 } }, { name: 'AccessDeniedException' }, null, 'x'])
      expect(isRetryableError(e)).toBe(false);
  });

  it('does nothing while paused, then picks up again', async () => {
    let paused = true;
    const { agent, sent, store, seen, detailOf } = setup({ paused: () => paused });
    expect(await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } })).toEqual([]);
    expect(sent).toHaveLength(0);
    paused = false;
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    paused = true;
    expect(await agent.handleTask(d)).toMatchObject({ status: 'FAILED', error: 'paused' });
    expect(store.tasks.size).toBe(0);
    expect(seen).toHaveLength(0);
    paused = false;
    expect(await agent.handleTask(d)).toMatchObject({ status: 'COMPLETED' });
  });

  it('caps tasks per agent per window, counting each task id once', async () => {
    const { agent, sent, detailOf, seen, completed, advance } = setup({ taskCap: { max: 2, windowMs: 3600_000 } });
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    const flaky = { ...d, trigger: { ...d.trigger!, payload: { pr: 7, throttle: 1 } } };
    await expect(agent.handleTask(flaky)).rejects.toThrow();     // counted once…
    expect((await agent.handleTask(flaky)).status).toBe('COMPLETED'); // …not again on the retry
    expect((await agent.handleTask({ ...d, taskId: 'two' })).status).toBe('COMPLETED');
    const capped = await agent.handleTask({ ...d, taskId: 'three' });
    expect(capped).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/Task cap reached: at most 2 tasks per 60 minutes/) });
    expect(seen.filter((s) => s.kind === 'review')).toHaveLength(3); // the throttled try, the retry, 'two'
    expect(completed.at(-1)).toMatchObject({ taskId: 'three', status: 'FAILED' });
    advance(3600_000);
    expect((await agent.handleTask({ ...d, taskId: 'four' })).status).toBe('COMPLETED');
  });

  it('validates the cap, and can turn it off', () => {
    expect(() => setup({ taskCap: { max: 0, windowMs: 1 } })).toThrow(/taskCap/);
    expect(() => setup({ taskCap: null })).not.toThrow();
  });

  it('isolates state by scope', async () => {
    let tenure = 'season-1';
    const { agent, sent, detailOf, seen } = setup({ scope: () => tenure });
    await agent.route({ id: 'e1', 'detail-type': 'Pull Request Opened', detail: { pr: 7, reviewers: ['rev-1'] } });
    const d = detailOf(sent[0]!);
    await agent.handleTask(d);
    await agent.handleTask({ ...d, taskId: 'b' });
    expect((seen[1]!.lines as string[]).length).toBe(1);
    tenure = 'season-2';
    await agent.handleTask({ ...d, taskId: 'c' });
    expect((seen[2]!.lines as string[]).length).toBe(0);
  });
});
