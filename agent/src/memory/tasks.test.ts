import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send },
  requireTableName: (t?: string) => t ?? 'test-table',
  TABLE_NAME: 'test-table',
}));

const {
  createTask,
  startTask,
  finishTask,
  getTask,
  toTaskResult,
  TASK_ENTITY,
} = await import('./tasks.js');

const conditionalFailure = () =>
  Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

const user = { type: 'user' as const, id: 'user-1' };

describe('createTask', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('writes a PENDING row keyed by task, conditionally, owned by the principal', async () => {
    const task = await createTask({
      taskId: 'task-1',
      principal: user,
      request: 'summarize the week',
      sessionId: 'sess-1',
      now: 1_000_000,
    });

    expect(task).toMatchObject({
      taskId: 'task-1',
      status: 'PENDING',
      principal: user,
      request: 'summarize the week',
      sessionId: 'sess-1',
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });

    const input = send.mock.calls[0][0].input;
    expect(input.Item).toMatchObject({
      pk: 'TASK#task-1',
      sk: 'STATUS',
      entity: TASK_ENTITY,
      status: 'PENDING',
      expiresAt: Math.floor(1_000_000 / 1000) + 24 * 60 * 60,
    });
    expect(input.ConditionExpression).toBe('attribute_not_exists(pk)');
  });

  it('generates a taskId and omits an unset sessionId', async () => {
    const task = await createTask({ principal: user, request: 'go', now: 1 });
    expect(task.taskId).toEqual(expect.any(String));
    expect('sessionId' in task).toBe(false);
    expect('createdBy' in task).toBe(false);
  });

  it('records createdBy for a host-gated system task (launcher differs from principal)', async () => {
    const task = await createTask({
      taskId: 'task-sys',
      principal: { type: 'system', id: 'booked' },
      request: 'nightly digest',
      createdBy: 'user-1',
      now: 1,
    });
    expect(task).toMatchObject({ principal: { type: 'system', id: 'booked' }, createdBy: 'user-1' });
    expect(send.mock.calls[0][0].input.Item).toMatchObject({ createdBy: 'user-1' });
  });

  it('requires a principal and a request', async () => {
    await expect(createTask({ principal: { type: 'user', id: '' }, request: 'x' })).rejects.toThrow(/principal/);
    await expect(createTask({ principal: user, request: '' })).rejects.toThrow(/request/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('startTask', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('claims the task by transitioning to RUNNING, allowing absent/PENDING/FAILED', async () => {
    const result = await startTask({ taskId: 'task-1', principal: user, request: 'go', now: 5 });
    expect(result).toEqual({ claimed: true });

    const input = send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ pk: 'TASK#task-1', sk: 'STATUS' });
    expect(input.ConditionExpression).toContain('attribute_not_exists(pk)');
    expect(input.ExpressionAttributeValues[':running']).toBe('RUNNING');
    // A one-shot task with no session persists an empty-string placeholder.
    expect(input.ExpressionAttributeValues[':sessionId']).toBe('');
  });

  it('returns claimed:false with the existing row when another invocation owns it', async () => {
    send
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({
        Item: {
          taskId: 'task-1',
          status: 'COMPLETED',
          principal: user,
          request: 'go',
          output: 'done',
          createdAt: 1,
          updatedAt: 2,
        },
      });

    const result = await startTask({ taskId: 'task-1', principal: user, request: 'go' });
    expect(result.claimed).toBe(false);
    expect(result).toMatchObject({ existing: { status: 'COMPLETED', output: 'done' } });
  });

  it('rethrows a non-conditional error', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(startTask({ taskId: 'task-1', principal: user, request: 'go' })).rejects.toThrow('boom');
  });
});

describe('finishTask', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('records COMPLETED with output, conditional on still RUNNING', async () => {
    const result = await finishTask({ taskId: 'task-1', status: 'COMPLETED', output: 'answer', now: 9 });
    expect(result).toEqual({ taskId: 'task-1', status: 'COMPLETED', output: 'answer' });

    const input = send.mock.calls[0][0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(pk) AND #status = :running');
    expect(input.ExpressionAttributeValues[':status']).toBe('COMPLETED');
    expect(input.ExpressionAttributeValues[':output']).toBe('answer');
  });

  it('records FAILED with an error message', async () => {
    const result = await finishTask({ taskId: 'task-1', status: 'FAILED', error: 'nope' });
    expect(result).toEqual({ taskId: 'task-1', status: 'FAILED', error: 'nope' });
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[':error']).toBe('nope');
  });
});

describe('getTask', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('normalizes the empty-string sessionId placeholder back to undefined', async () => {
    send.mockResolvedValueOnce({
      Item: {
        taskId: 'task-1',
        status: 'RUNNING',
        principal: user,
        request: 'go',
        sessionId: '',
        createdAt: 1,
        updatedAt: 2,
      },
    });

    const task = await getTask('task-1');
    expect(task).toMatchObject({ taskId: 'task-1', status: 'RUNNING' });
    expect(task?.sessionId).toBeUndefined();
    expect(task?.createdBy).toBeUndefined();
  });

  it('reads createdBy back when present', async () => {
    send.mockResolvedValueOnce({
      Item: {
        taskId: 'task-sys',
        status: 'COMPLETED',
        principal: { type: 'system', id: 'booked' },
        request: 'go',
        createdBy: 'user-1',
        output: 'done',
        createdAt: 1,
        updatedAt: 2,
      },
    });
    const task = await getTask('task-sys');
    expect(task?.createdBy).toBe('user-1');
  });

  it('returns null when there is no row, and for an empty id without querying', async () => {
    send.mockResolvedValueOnce({});
    expect(await getTask('missing')).toBeNull();
    expect(await getTask('')).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('toTaskResult', () => {
  it('projects to the public envelope, omitting unset output/error', () => {
    expect(toTaskResult({ taskId: 't', status: 'RUNNING' })).toEqual({ taskId: 't', status: 'RUNNING' });
    expect(toTaskResult({ taskId: 't', status: 'COMPLETED', output: 'x' })).toEqual({
      taskId: 't',
      status: 'COMPLETED',
      output: 'x',
    });
  });
});
