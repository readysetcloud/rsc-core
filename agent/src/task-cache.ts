import type { AgentTaskResult } from './memory/tasks.js';

// A short-lived, in-process cache of finished task results. The AgentCore runtime
// stays warm for a while and keeps session affinity, so a duplicate delivery or a
// quick poll that lands on the same instance can be answered without touching
// DynamoDB. This is ONLY an accelerator: the runtime scales horizontally and can
// be reclaimed, so a miss (cold instance, different microVM) is always correct —
// the durable task row (memory/tasks.ts) and the "Agent Task Completed" event are
// the source of truth. Never treat a cache miss as "task not found".

interface CacheEntry {
  result: AgentTaskResult;
  expiresAt: number;
}

/** Options for {@link TaskResultCache}. */
export interface TaskResultCacheOptions {
  /** How long a result stays cached, in milliseconds. Defaults to 2 minutes. */
  ttlMs?: number;
  /** Clock injection for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * An in-memory TTL cache keyed by taskId. Populate it on finish (`set`) and check
 * it before claiming/re-running a task or serving a poll (`get`) — layered in
 * front of the durable row, never in place of it.
 */
export class TaskResultCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TaskResultCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Returns a cached result if present and unexpired; prunes it and returns undefined otherwise. */
  get(taskId: string): AgentTaskResult | undefined {
    const entry = this.entries.get(taskId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(taskId);
      return undefined;
    }
    return entry.result;
  }

  /** Caches a finished result under its taskId with the configured TTL. */
  set(result: AgentTaskResult): void {
    this.entries.set(result.taskId, {
      result,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /** Removes a task's cached result, if any. */
  delete(taskId: string): void {
    this.entries.delete(taskId);
  }
}
