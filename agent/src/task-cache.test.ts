import { describe, it, expect } from 'vitest';
import { TaskResultCache } from './task-cache.js';

describe('TaskResultCache', () => {
  it('returns a cached result within its TTL and undefined after it expires', () => {
    let clock = 1000;
    const cache = new TaskResultCache({ ttlMs: 100, now: () => clock });

    cache.set({ taskId: 'task-1', status: 'COMPLETED', output: 'answer' });
    expect(cache.get('task-1')).toEqual({ taskId: 'task-1', status: 'COMPLETED', output: 'answer' });

    clock += 50; // still within TTL
    expect(cache.get('task-1')).toMatchObject({ output: 'answer' });

    clock += 100; // past TTL
    expect(cache.get('task-1')).toBeUndefined();
  });

  it('returns undefined for an unknown task (a miss is not "not found")', () => {
    const cache = new TaskResultCache();
    expect(cache.get('nope')).toBeUndefined();
  });

  it('deletes a cached result', () => {
    const cache = new TaskResultCache();
    cache.set({ taskId: 'task-1', status: 'FAILED', error: 'boom' });
    cache.delete('task-1');
    expect(cache.get('task-1')).toBeUndefined();
  });
});
