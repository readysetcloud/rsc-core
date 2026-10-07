import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send },
  requireTableName: (t?: string) => t ?? 'test-table',
  TABLE_NAME: 'test-table',
}));

const { readAgentState, updateAgentState, AGENT_STATE_ENTITY } = await import('./state-store.js');

const conflict = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

describe('agent state store', () => {
  beforeEach(() => send.mockReset());

  it('reads consistently and returns null when absent', async () => {
    send.mockResolvedValueOnce({});
    expect(await readAgentState({ agentId: 'a1', name: 'agenda' })).toBeNull();
    const input = send.mock.calls[0][0].input;
    expect(input).toMatchObject({ TableName: 'test-table', Key: { pk: 'AGENT#a1', sk: 'STATE#agenda' }, ConsistentRead: true });
    send.mockResolvedValueOnce({ Item: { value: { goals: [] }, revision: 2, updatedAt: 5 } });
    expect(await readAgentState({ agentId: 'a1', name: 'agenda', scope: 'season-1' })).toEqual({ value: { goals: [] }, revision: 2, updatedAt: 5 });
    expect(send.mock.calls[1][0].input.Key).toEqual({ pk: 'AGENT#a1', sk: 'STATE#agenda#season-1' });
    await expect(readAgentState({ agentId: '', name: 'agenda' })).rejects.toThrow(/agentId/);
  });

  it('creates the first revision conditionally', async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const r = await updateAgentState<{ n: number }>({ agentId: 'a1', name: 'agenda', now: 1000, ttlMs: 60_000, update: (c) => ({ n: (c?.n ?? 0) + 1 }) });
    expect(r).toEqual({ value: { n: 1 }, revision: 1, updatedAt: 1000 });
    const put = send.mock.calls[1][0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(put.Item).toMatchObject({ pk: 'AGENT#a1', sk: 'STATE#agenda', entity: AGENT_STATE_ENTITY, value: { n: 1 }, revision: 1, expiresAt: 61 });
  });

  it('writes under the revision read and retries on a conflict', async () => {
    send
      .mockResolvedValueOnce({ Item: { value: { n: 1 }, revision: 1, updatedAt: 1 } })
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ Item: { value: { n: 5 }, revision: 2, updatedAt: 2 } })
      .mockResolvedValueOnce({});
    const r = await updateAgentState<{ n: number }>({ agentId: 'a1', name: 'agenda', now: 9, update: (c) => ({ n: (c?.n ?? 0) + 1 }) });
    expect(r).toEqual({ value: { n: 6 }, revision: 3, updatedAt: 9 });
    const put = send.mock.calls[3][0].input;
    expect(put.ConditionExpression).toBe('revision = :revision');
    expect(put.ExpressionAttributeValues).toEqual({ ':revision': 2 });
  });

  it('writes nothing when the update returns the current document', async () => {
    const value = { n: 1 };
    send.mockResolvedValueOnce({ Item: { value, revision: 4, updatedAt: 1 } });
    const r = await updateAgentState<{ n: number }>({ agentId: 'a1', name: 'agenda', update: (c) => c as { n: number } });
    expect(r.revision).toBe(4);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempts and rethrows other errors', async () => {
    send.mockResolvedValue({ Item: { value: { n: 1 }, revision: 1, updatedAt: 1 } });
    send.mockImplementation(async (cmd: { input: { Item?: unknown } }) => {
      if (cmd.input.Item) throw conflict();
      return { Item: { value: { n: 1 }, revision: 1, updatedAt: 1 } };
    });
    await expect(updateAgentState<{ n: number }>({ agentId: 'a1', name: 'agenda', attempts: 2, update: () => ({ n: 2 }) })).rejects.toThrow(/changed 2 times/);
    send.mockReset();
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'));
    await expect(updateAgentState<{ n: number }>({ agentId: 'a1', name: 'agenda', update: () => ({ n: 2 }) })).rejects.toThrow('boom');
  });
});
