import { describe, it, expect, vi, beforeEach } from 'vitest';

const ebSend = vi.fn();
vi.mock('../aws/events.js', () => ({
  eventBridge: { send: ebSend },
}));

const ddbSend = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send: ddbSend },
  requireTableName: () => 'test-table',
  TABLE_NAME: 'test-table',
}));

const {
  requestSession,
  createSessionFromEvent,
  SESSION_REQUEST_SOURCE,
  SESSION_REQUEST_DETAIL_TYPE,
} = await import('./session-events.js');

describe('requestSession', () => {
  beforeEach(() => {
    ebSend.mockReset();
    ebSend.mockResolvedValue({});
  });

  it('emits a Create Agent Session event and returns the sessionId', async () => {
    const { sessionId } = await requestSession({
      userId: 'user-1',
      sessionId: 'sess-1',
      systemPrompt: 'be terse',
      mcpServers: { blog: { url: 'https://gw/mcp', transport: 'streamable-http' } },
      title: 'Ask your blog',
    });

    expect(sessionId).toBe('sess-1');
    expect(ebSend).toHaveBeenCalledTimes(1);
    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry.Source).toBe(SESSION_REQUEST_SOURCE);
    expect(entry.DetailType).toBe(SESSION_REQUEST_DETAIL_TYPE);
    const detail = JSON.parse(entry.Detail);
    expect(detail).toMatchObject({
      sessionId: 'sess-1',
      userId: 'user-1',
      systemPrompt: 'be terse',
      title: 'Ask your blog',
      mcpServers: { blog: { url: 'https://gw/mcp', transport: 'streamable-http' } },
    });
  });

  it('generates a sessionId when none is supplied', async () => {
    const { sessionId } = await requestSession({ userId: 'user-1' });
    expect(sessionId).toMatch(/[0-9a-f-]{36}/);
    const detail = JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.sessionId).toBe(sessionId);
  });

  it('targets a custom bus when eventBusName is given', async () => {
    await requestSession({ userId: 'user-1', eventBusName: 'my-bus' });
    expect(ebSend.mock.calls[0][0].input.Entries[0].EventBusName).toBe('my-bus');
  });

  it('requires a userId', async () => {
    await expect(requestSession({ userId: '' })).rejects.toThrow(/userId/);
  });
});

describe('createSessionFromEvent', () => {
  beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({});
  });

  it('creates the config row with the requester-chosen sessionId', async () => {
    const config = await createSessionFromEvent({
      sessionId: 'sess-9',
      userId: 'user-2',
      systemPrompt: 'hi',
    });
    expect(config).toMatchObject({ sessionId: 'sess-9', userId: 'user-2', systemPrompt: 'hi' });
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(ddbSend.mock.calls[0][0].input.Item).toMatchObject({ pk: 'SESSION#sess-9' });
  });

  it('rejects an event missing userId or sessionId', async () => {
    await expect(createSessionFromEvent({ sessionId: 's', userId: '' })).rejects.toThrow(/userId/);
    await expect(createSessionFromEvent({ sessionId: '', userId: 'u' })).rejects.toThrow(/sessionId/);
  });
});
