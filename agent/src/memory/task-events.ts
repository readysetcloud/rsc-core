import { randomUUID } from 'node:crypto';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridge } from '../aws/events.js';
import type { McpServerSpec } from './sessions.js';
import type { AgentTaskResult, Principal } from './tasks.js';

// The EventBridge contract for autonomous agent tasks — the async, decoupled
// bookends of the task path:
//
//   requestAgentTask()  emits  "Run Agent Task"        → a consumer invokes the runtime
//   the runtime         emits  "Agent Task Completed"  → any app reacts to the result
//
// Both mirror the ecosystem's existing "Create Agent Session" / "Track Activity"
// handoffs: a first-party app needs only `events:PutEvents`, never cross-stack
// access to the agent's table. "Run Agent Task" lets an app trigger a run
// without holding a connection; "Agent Task Completed" is how the result crosses
// the permissions boundary (an event, not a table read) — including for a slow
// task whose synchronous caller already gave up waiting.
//
// Trust: the default bus is account-internal, so emitters are first-party app
// Lambdas, not arbitrary end users. That is what lets a "Run Agent Task" event
// assert its own `principal` (including a `system` one). A public, user-facing
// trigger is the API path (POST /agent/tasks), where identity is the verified
// JWT and a system principal needs an explicit authz gate.

/** EventBridge `source` for both task events (shared with session events). */
export const TASK_EVENT_SOURCE = 'readysetcloud.agent';
/** `detail-type` an app emits to trigger a run. */
export const TASK_REQUEST_DETAIL_TYPE = 'Run Agent Task';
/** `detail-type` the runtime emits when a run finishes (success or failure). */
export const TASK_COMPLETED_DETAIL_TYPE = 'Agent Task Completed';

/** The `detail` payload of a "Run Agent Task" event. */
export interface TaskRequestDetail {
  taskId: string;
  principal: Principal;
  request: string;
  sessionId?: string;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  mcpServers?: Record<string, McpServerSpec>;
}

/** The `detail` payload of an "Agent Task Completed" event: the result + who ran it. */
export interface TaskCompletedDetail extends AgentTaskResult {
  principal: Principal;
}

/** Options for {@link requestAgentTask}. */
export interface RequestAgentTaskOptions {
  /** Identity the run acts as. Required. */
  principal: Principal;
  /** The instruction the agent runs. Required. */
  request: string;
  /** Provide to use a specific task id; a UUID is generated when omitted. */
  taskId?: string;
  /** Optional session to run within (history/continuity). */
  sessionId?: string;
  /** Per-run behavior overrides (default to the session's / package defaults). */
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  mcpServers?: Record<string, McpServerSpec>;
  /** EventBridge bus to publish to; defaults to the account's `default` bus. */
  eventBusName?: string;
}

/**
 * Triggers an autonomous run by emitting a "Run Agent Task" event, returning the
 * `taskId` immediately so the caller can track it (via the completed event or a
 * `GET /agent/tasks/{id}`). The owning stack's consumer invokes the runtime,
 * which records the row and emits the result. The caller needs only
 * `events:PutEvents`. This is the fire-and-forget path; use the API's `wait` for
 * an inline result on a short task.
 */
export async function requestAgentTask(
  options: RequestAgentTaskOptions,
): Promise<{ taskId: string }> {
  const { principal, request } = options;
  if (!principal?.id) throw new Error('requestAgentTask requires a principal');
  if (!request) throw new Error('requestAgentTask requires a request');

  const taskId = options.taskId ?? randomUUID();
  const detail: TaskRequestDetail = {
    taskId,
    principal,
    request,
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.mcpServers !== undefined ? { mcpServers: options.mcpServers } : {}),
  };

  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: TASK_EVENT_SOURCE,
      DetailType: TASK_REQUEST_DETAIL_TYPE,
      Detail: JSON.stringify(detail),
      ...(options.eventBusName ? { EventBusName: options.eventBusName } : {}),
    }],
  }));

  return { taskId };
}

/** Options for {@link emitTaskCompleted}: the result, who ran it, and an optional bus. */
export interface EmitTaskCompletedOptions {
  result: AgentTaskResult;
  principal: Principal;
  /** EventBridge bus to publish to; defaults to the account's `default` bus. */
  eventBusName?: string;
}

/**
 * Emits an "Agent Task Completed" event with the run's result. The runtime calls
 * this on every finished run (success or failure), so the result reaches async
 * consumers uniformly — regardless of whether a synchronous caller was still
 * waiting. The detail is the {@link AgentTaskResult} envelope plus the principal.
 */
export async function emitTaskCompleted(options: EmitTaskCompletedOptions): Promise<void> {
  const { result, principal } = options;
  const detail: TaskCompletedDetail = { ...result, principal };

  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: TASK_EVENT_SOURCE,
      DetailType: TASK_COMPLETED_DETAIL_TYPE,
      Detail: JSON.stringify(detail),
      ...(options.eventBusName ? { EventBusName: options.eventBusName } : {}),
    }],
  }));
}
