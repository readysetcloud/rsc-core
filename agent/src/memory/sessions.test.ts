import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('../aws/ddb.js', () => ({
  ddb: { send },
  requireTableName: () => 'test-table',
  TABLE_NAME: 'test-table',
}));

const { createSession, getSessionConfig, SESSION_CONFIG_ENTITY } = await import('./sessions.js');

describe('createSession', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('writes a config row owned by the caller, keyed by session, conditionally', async () => {
    const config = await createSession({
      userId: 'user-1',
      sessionId: 'sess-1',
      systemPrompt: 'be terse',
      modelId: 'model-x',
      temperature: 0.2,
      now: 1_000_000,
    });

    expect(config).toMatchObject({
      sessionId: 'sess-1',
      userId: 'user-1',
      systemPrompt: 'be terse',
      modelId: 'model-x',
      temperature: 0.2,
      createdAt: 1_000_000,
    });

    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0].input;
    expect(input.Item).toMatchObject({
      pk: 'SESSION#sess-1',
      sk: 'CONFIG',
      entity: SESSION_CONFIG_ENTITY,
      userId: 'user-1',
      systemPrompt: 'be terse',
      expiresAt: Math.floor(1_000_000 / 1000) + 30 * 24 * 60 * 60,
    });
    // Never clobber an existing session's config/owner.
    expect(input.ConditionExpression).toBe('attribute_not_exists(pk)');
  });

  it('generates a session id when none is provided and omits unset fields', async () => {
    const config = await createSession({ userId: 'user-1', now: 5 });
    expect(config.sessionId).toEqual(expect.any(String));
    expect(config.sessionId.length).toBeGreaterThan(0);
    expect('systemPrompt' in config).toBe(false);
    expect('modelId' in config).toBe(false);
  });

  it('persists tool selection and MCP servers', async () => {
    const mcpServers = { docs: { url: 'https://tools.example/mcp' } };
    const config = await createSession({
      userId: 'user-1',
      sessionId: 'sess-2',
      tools: ['recall_memory', 'get_current_time'],
      mcpServers,
      now: 1,
    });

    expect(config.tools).toEqual(['recall_memory', 'get_current_time']);
    expect(config.mcpServers).toEqual(mcpServers);
    expect(send.mock.calls[0][0].input.Item).toMatchObject({
      tools: ['recall_memory', 'get_current_time'],
      mcpServers,
    });
  });

  it('persists an authority-minted authHeader on an MCP server spec', async () => {
    const mcpServers = {
      blog: {
        url: 'https://mcp.booked.example/mcp',
        authHeader: { name: 'x-booked-auth', value: 'payload.sig' },
      },
    };
    const config = await createSession({
      userId: 'user-1',
      sessionId: 'sess-3',
      mcpServers,
      now: 1,
    });

    expect(config.mcpServers).toEqual(mcpServers);
    expect(send.mock.calls[0][0].input.Item).toMatchObject({ mcpServers });
  });

  it('requires a userId', async () => {
    await expect(createSession({ userId: '' })).rejects.toThrow(/userId/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('getSessionConfig', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it('returns the stored config', async () => {
    send.mockResolvedValueOnce({
      Item: {
        pk: 'SESSION#sess-1',
        sk: 'CONFIG',
        sessionId: 'sess-1',
        userId: 'user-1',
        systemPrompt: 'be terse',
        modelId: 'model-x',
        createdAt: 42,
      },
    });

    const config = await getSessionConfig('sess-1');
    expect(config).toEqual({
      sessionId: 'sess-1',
      userId: 'user-1',
      systemPrompt: 'be terse',
      modelId: 'model-x',
      temperature: undefined,
      maxTokens: undefined,
      tools: undefined,
      mcpServers: undefined,
      title: undefined,
      createdAt: 42,
    });
    expect(send.mock.calls[0][0].input.Key).toEqual({ pk: 'SESSION#sess-1', sk: 'CONFIG' });
  });

  it('returns null when there is no config row', async () => {
    send.mockResolvedValueOnce({});
    expect(await getSessionConfig('missing')).toBeNull();
  });

  it('returns null for an empty session id without querying', async () => {
    expect(await getSessionConfig('')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
