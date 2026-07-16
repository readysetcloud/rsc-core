import { describe, it, expect, vi, beforeEach } from 'vitest';

const ebSend = vi.fn();
vi.mock('../aws/events.js', () => ({
  eventBridge: { send: ebSend },
}));

const {
  requestAgentTask,
  emitTaskCompleted,
  TASK_EVENT_SOURCE,
  TASK_REQUEST_DETAIL_TYPE,
  TASK_COMPLETED_DETAIL_TYPE,
} = await import('./task-events.js');

const user = { type: 'user' as const, id: 'user-1' };

describe('requestAgentTask', () => {
  beforeEach(() => {
    ebSend.mockReset();
    ebSend.mockResolvedValue({});
  });

  it('emits a Run Agent Task event and returns the taskId', async () => {
    const { taskId } = await requestAgentTask({
      taskId: 'task-1',
      principal: user,
      request: 'summarize the week',
      mcpServers: { blog: { url: 'https://gw/mcp' } },
    });

    expect(taskId).toBe('task-1');
    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry.Source).toBe(TASK_EVENT_SOURCE);
    expect(entry.DetailType).toBe(TASK_REQUEST_DETAIL_TYPE);
    const detail = JSON.parse(entry.Detail);
    expect(detail).toMatchObject({
      taskId: 'task-1',
      principal: user,
      request: 'summarize the week',
      mcpServers: { blog: { url: 'https://gw/mcp' } },
    });
  });

  it('carries a system principal through the detail', async () => {
    await requestAgentTask({ principal: { type: 'system', id: 'booked' }, request: 'nightly digest' });
    const detail = JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.principal).toEqual({ type: 'system', id: 'booked' });
  });

  it('generates a taskId and can target a custom bus', async () => {
    const { taskId } = await requestAgentTask({ principal: user, request: 'go', eventBusName: 'my-bus' });
    expect(taskId).toMatch(/[0-9a-f-]{36}/);
    expect(ebSend.mock.calls[0][0].input.Entries[0].EventBusName).toBe('my-bus');
  });

  it('requires a principal and a request', async () => {
    await expect(requestAgentTask({ principal: { type: 'user', id: '' }, request: 'x' })).rejects.toThrow(/principal/);
    await expect(requestAgentTask({ principal: user, request: '' })).rejects.toThrow(/request/);
  });
});

describe('emitTaskCompleted', () => {
  beforeEach(() => {
    ebSend.mockReset();
    ebSend.mockResolvedValue({});
  });

  it('emits the result envelope plus principal as the detail', async () => {
    await emitTaskCompleted({
      result: { taskId: 'task-1', status: 'COMPLETED', output: 'answer' },
      principal: user,
    });

    const entry = ebSend.mock.calls[0][0].input.Entries[0];
    expect(entry.Source).toBe(TASK_EVENT_SOURCE);
    expect(entry.DetailType).toBe(TASK_COMPLETED_DETAIL_TYPE);
    expect(JSON.parse(entry.Detail)).toEqual({
      taskId: 'task-1',
      status: 'COMPLETED',
      output: 'answer',
      principal: user,
    });
  });
});
