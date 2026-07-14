import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send },
  requireTableName: () => 'test-table',
  TABLE_NAME: 'test-table',
}));

const { DynamoSnapshotStorage } = await import('./dynamo-snapshot-storage.js');

describe('DynamoSnapshotStorage', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  const location = { sessionId: 'sess-1', scope: 'agent' as const, scopeId: 'assistant' };

  it('writes a snapshot row and a LATEST pointer when isLatest', async () => {
    const store = new DynamoSnapshotStorage();
    await store.saveSnapshot({
      location,
      snapshotId: 'snap-1',
      isLatest: true,
      snapshot: { messages: ['a'] } as never,
    });

    expect(send).toHaveBeenCalledTimes(2);
    const items = send.mock.calls.map((c) => c[0].input.Item);

    expect(items[0]).toMatchObject({
      pk: 'SESSION#sess-1',
      sk: 'SNAPSHOT#agent#assistant#snap-1',
      snapshotId: 'snap-1',
      snapshot: { messages: ['a'] },
    });
    expect(items[1]).toMatchObject({
      pk: 'SESSION#sess-1',
      sk: 'LATEST#agent#assistant',
      snapshotId: 'snap-1',
    });
  });

  it('loads the latest snapshot by following the pointer', async () => {
    const store = new DynamoSnapshotStorage();
    send
      .mockResolvedValueOnce({ Item: { snapshotId: 'snap-42' } }) // LATEST pointer
      .mockResolvedValueOnce({ Item: { snapshot: { messages: ['x'] } } }); // snapshot row

    const result = await store.loadSnapshot({ location });

    expect(result).toEqual({ messages: ['x'] });
    // second GET targeted the resolved snapshot id under the scope
    expect(send.mock.calls[1][0].input.Key).toEqual({
      pk: 'SESSION#sess-1',
      sk: 'SNAPSHOT#agent#assistant#snap-42',
    });
  });

  it('returns null when there is no latest pointer', async () => {
    const store = new DynamoSnapshotStorage();
    send.mockResolvedValueOnce({}); // no pointer item
    const result = await store.loadSnapshot({ location });
    expect(result).toBeNull();
  });
});
