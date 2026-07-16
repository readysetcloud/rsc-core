import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '@strands-agents/sdk';

// Mock the data-plane deps runAgentTask orchestrates so we assert the flow.
const startTask = vi.fn();
const finishTask = vi.fn();
const emitTaskCompleted = vi.fn();
vi.mock('./memory/tasks.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./memory/tasks.js')>()),
  startTask: (...args: unknown[]) => startTask(...args),
  finishTask: (...args: unknown[]) => finishTask(...args),
}));
vi.mock('./memory/task-events.js', () => ({
  emitTaskCompleted: (...args: unknown[]) => emitTaskCompleted(...args),
}));

const { handleTask, runAgentTask } = await import('./task.js');

describe('handleTask', () => {
  it('invokes the agent, flushes memory, and returns the buffered text', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn().mockResolvedValue({ toString: () => 'the answer' });
    const agent = { invoke, memoryManager: { flush } } as unknown as Agent;

    const output = await handleTask(agent, { request: 'do the thing' });

    expect(invoke).toHaveBeenCalledWith('do the thing');
    expect(output).toBe('the answer');
    // Memory is flushed at the turn boundary for durability (as in a chat turn).
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('works without a memory manager (stateless run)', async () => {
    const invoke = vi.fn().mockResolvedValue({ toString: () => 'ok' });
    const agent = { invoke } as unknown as Agent;

    expect(await handleTask(agent, { request: 'x' })).toBe('ok');
  });
});

describe('runAgentTask', () => {
  const principal = { type: 'user' as const, id: 'user-1' };

  beforeEach(() => {
    startTask.mockReset();
    finishTask.mockReset();
    emitTaskCompleted.mockReset();
    emitTaskCompleted.mockResolvedValue(undefined);
  });

  it('claims, runs, finishes COMPLETED, emits, and cleans up on success', async () => {
    startTask.mockResolvedValue({ claimed: true });
    finishTask.mockResolvedValue({ taskId: 't1', status: 'COMPLETED', output: 'done' });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const agent = { invoke: vi.fn().mockResolvedValue({ toString: () => 'done' }) } as unknown as Agent;
    const buildAgent = vi.fn().mockResolvedValue({ agent, cleanup });

    const result = await runAgentTask({ taskId: 't1', principal, request: 'go', buildAgent });

    expect(result).toEqual({ taskId: 't1', status: 'COMPLETED', output: 'done' });
    expect(finishTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', status: 'COMPLETED', output: 'done' }));
    expect(emitTaskCompleted).toHaveBeenCalledWith(expect.objectContaining({ principal, result }));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does NOT build or run when the claim is lost (duplicate delivery)', async () => {
    startTask.mockResolvedValue({
      claimed: false,
      existing: { taskId: 't1', status: 'COMPLETED', output: 'earlier', principal, request: 'go', createdAt: 1, updatedAt: 2 },
    });
    const buildAgent = vi.fn();

    const result = await runAgentTask({ taskId: 't1', principal, request: 'go', buildAgent });

    expect(buildAgent).not.toHaveBeenCalled();
    expect(finishTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'COMPLETED', output: 'earlier' });
  });

  it('records FAILED (and still emits + cleans up) when the turn throws', async () => {
    startTask.mockResolvedValue({ claimed: true });
    finishTask.mockResolvedValue({ taskId: 't1', status: 'FAILED', error: 'boom' });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const buildAgent = vi.fn().mockResolvedValue({
      agent: { invoke: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Agent,
      cleanup,
    });

    const result = await runAgentTask({ taskId: 't1', principal, request: 'go', buildAgent });

    expect(finishTask).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', error: 'boom' }));
    expect(emitTaskCompleted).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FAILED');
  });

  it('serves a warm cache hit without claiming', async () => {
    const cache = { get: vi.fn().mockReturnValue({ taskId: 't1', status: 'COMPLETED', output: 'cached' }), set: vi.fn() };
    const buildAgent = vi.fn();

    const result = await runAgentTask({ taskId: 't1', principal, request: 'go', buildAgent, cache: cache as never });

    expect(result).toMatchObject({ output: 'cached' });
    expect(startTask).not.toHaveBeenCalled();
    expect(buildAgent).not.toHaveBeenCalled();
  });
});
