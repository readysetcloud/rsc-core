import { describe, it, expect, vi } from 'vitest';
import { handleTask } from './task.js';
import type { Agent } from '@strands-agents/sdk';

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
