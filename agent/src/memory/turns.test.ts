import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared DDB client before importing the SUT.
const send = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send },
  requireTableName: () => 'test-table',
  TABLE_NAME: 'test-table',
}));

const { recordTurn, turnKey, TURN_ENTITY } = await import('./turns.js');

describe('turnKey', () => {
  it('builds tenant-scoped keys', () => {
    expect(turnKey('user-1', 'sess-9', 1000, 'user')).toEqual({
      pk: 'MEMORY#user-1',
      sk: 'TURN#sess-9#1000#user',
    });
  });
});

describe('recordTurn', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('writes a user row and an assistant row with a 30-day TTL', async () => {
    await recordTurn({
      userId: 'user-1',
      sessionId: 'sess-9',
      request: 'hi there',
      response: 'hello!',
      now: 1_000_000,
    });

    expect(send).toHaveBeenCalledTimes(2);
    const items = send.mock.calls.map((c) => c[0].input.Item);

    const user = items.find((i) => i.role === 'user');
    const assistant = items.find((i) => i.role === 'assistant');

    expect(user).toMatchObject({
      pk: 'MEMORY#user-1',
      sk: 'TURN#sess-9#1000000#user',
      entity: TURN_ENTITY,
      text: 'hi there',
      ts: 1_000_000,
    });
    // assistant row is +1ms so it sorts after the user row
    expect(assistant.sk).toBe('TURN#sess-9#1000001#assistant');
    // expiresAt = floor(ts/1000) + 30d
    expect(user.expiresAt).toBe(Math.floor(1_000_000 / 1000) + 30 * 24 * 60 * 60);
  });

  it('skips empty text and missing identity', async () => {
    await recordTurn({ userId: 'user-1', sessionId: 'sess-9', request: '   ', response: '' });
    expect(send).not.toHaveBeenCalled();

    await recordTurn({ userId: '', sessionId: 'sess-9', request: 'hi', response: 'yo' });
    expect(send).not.toHaveBeenCalled();
  });
});
