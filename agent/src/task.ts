import type { Agent } from '@strands-agents/sdk';
import {
  startTask,
  finishTask,
  toTaskResult,
  type Principal,
  type AgentTaskResult,
} from './memory/tasks.js';
import { emitTaskCompleted } from './memory/task-events.js';
import type { TaskResultCache } from './task-cache.js';

// The buffered sibling of handleUserMessage (agent.ts). Where a chat turn streams
// wire messages to a browser, an autonomous task runs the agent to completion and
// returns the final text — no transport, no streaming. The host (a Lambda, a
// test) records the durable row and emits the result event around this call; this
// function is just "run one turn and give me the answer".

/** Options for {@link handleTask}. */
export interface HandleTaskOptions {
  /** The instruction the agent runs. */
  request: string;
}

/**
 * Runs one autonomous turn end-to-end: invokes the agent, buffers the response,
 * flushes the memory manager so the turn is durably captured, and returns the
 * assistant text.
 *
 * Mirrors {@link handleUserMessage} but with no streaming — the caller wants the
 * whole result, not a stream of frames. As with a chat turn, memory extraction
 * is fire-and-forget, so we `flush()` at this boundary to guarantee durability
 * even if the runtime is reclaimed afterward (`flush()` is a no-op when no store
 * has extraction configured).
 *
 * Build the agent once per task with `createAssistant` (the host loads the
 * session/task config, tools, and memory manager), then pass it here.
 */
export async function handleTask(
  agent: Agent,
  { request }: HandleTaskOptions,
): Promise<string> {
  const result = await agent.invoke(request);

  await agent.memoryManager?.flush();

  return result.toString();
}

/** A host-built agent for a task, plus optional teardown (e.g. MCP disconnects). */
export interface BuiltTaskAgent {
  /** The configured Strands agent to run the task with. */
  agent: Agent;
  /** Best-effort cleanup run after the turn (disconnect MCP clients, etc.). */
  cleanup?: () => Promise<void>;
}

/** Options for {@link runAgentTask}. */
export interface RunAgentTaskOptions {
  /** The task's id (idempotency key + result-row key). */
  taskId: string;
  /** Identity the run acts as. */
  principal: Principal;
  /** The instruction the agent runs. */
  request: string;
  /** Optional session the task runs within (continuity); absent = one-shot. */
  sessionId?: string;
  /**
   * Builds the agent for this task — called ONLY after the durable claim
   * succeeds, so a duplicate delivery never does the (potentially expensive)
   * build. The host loads config, resolves tools, connects MCP servers, and
   * returns the agent plus any `cleanup`.
   */
  buildAgent: () => Promise<BuiltTaskAgent>;
  /** Optional warm-instance result cache (accelerator only; never the source of truth). */
  cache?: TaskResultCache;
  /** EventBridge bus for the completion event; defaults to the account default bus. */
  eventBusName?: string;
  /** Table for the task rows; defaults to the `TABLE_NAME` env. */
  tableName?: string;
}

/**
 * Runs one autonomous task to completion, owning its full durable lifecycle — the
 * host-agnostic orchestration that any host (a Lambda, a test) can reuse:
 *
 * 1. **Warm cache + durable claim** make the run idempotent under at-least-once
 *    delivery. Exactly one invocation claims the task; a duplicate returns the
 *    existing result (or reports it in flight) without building or re-running the
 *    agent — the conditional claim in {@link startTask} is the correctness guard,
 *    the optional {@link cache} only a fast path.
 * 2. The claiming invocation builds the agent (via `buildAgent`, after the claim),
 *    runs the buffered turn ({@link handleTask}), and records COMPLETED/FAILED.
 * 3. It always emits "Agent Task Completed" and caches the result, so the outcome
 *    reaches async consumers over the bus uniformly.
 *
 * Transport/identity/memory are the host's concerns (injected through
 * `buildAgent`), keeping this free of any AgentCore or transport coupling.
 */
export async function runAgentTask(options: RunAgentTaskOptions): Promise<AgentTaskResult> {
  const { taskId, principal, request, sessionId, buildAgent, cache, eventBusName, tableName } = options;

  const cached = cache?.get(taskId);
  if (cached) return cached;

  const claim = await startTask({
    taskId,
    principal,
    request,
    ...(sessionId ? { sessionId } : {}),
    ...(tableName ? { tableName } : {}),
  });
  if (!claim.claimed) {
    const existing = claim.existing;
    const result: AgentTaskResult = existing ? toTaskResult(existing) : { taskId, status: 'RUNNING' };
    // Cache only terminal outcomes; a still-RUNNING peer will finish + emit.
    if (existing && (existing.status === 'COMPLETED' || existing.status === 'FAILED')) {
      cache?.set(result);
    }
    return result;
  }

  let built: BuiltTaskAgent | undefined;
  let result: AgentTaskResult;
  try {
    built = await buildAgent();
    const output = await handleTask(built.agent, { request });
    result = await finishTask({ taskId, status: 'COMPLETED', output, ...(tableName ? { tableName } : {}) });
  } catch (err) {
    result = await finishTask({
      taskId,
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Unknown error',
      ...(tableName ? { tableName } : {}),
    });
  } finally {
    if (built?.cleanup) await built.cleanup();
  }

  cache?.set(result);
  await emitTaskCompleted({ result, principal, ...(eventBusName ? { eventBusName } : {}) });
  return result;
}
