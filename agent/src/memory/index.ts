// Strands-free memory subpath (@readysetcloud/agent/memory).
//
// Lambda consumers (session-create handlers, snapshot storage) need only the
// data plane. Importing the package root would transitively load the Strands
// SDK (via agent.ts) and its optional integrations — unnecessary weight and a
// bundling hazard. This barrel exposes just the modules that have no runtime
// dependency on @strands-agents/sdk (the snapshot storage uses type-only
// imports, which are erased at build).

export { DynamoSnapshotStorage } from './dynamo-snapshot-storage.js';
export {
  createSession,
  getSessionConfig,
  SESSION_CONFIG_ENTITY,
  type SessionConfig,
  type CreateSessionOptions,
  type McpServerSpec,
} from './sessions.js';
export {
  requestSession,
  createSessionFromEvent,
  SESSION_REQUEST_SOURCE,
  SESSION_REQUEST_DETAIL_TYPE,
  type SessionRequestDetail,
  type RequestSessionOptions,
} from './session-events.js';

// Autonomous (non-chat) task records: the durable coordination/idempotency row
// for a request/response agent run. Strands-free, so Lambdas can import it.
export {
  createTask,
  startTask,
  finishTask,
  getTask,
  toTaskResult,
  TASK_ENTITY,
  type Principal,
  type TaskStatus,
  type AgentTask,
  type AgentTaskResult,
  type CreateTaskOptions,
  type StartTaskOptions,
  type StartTaskResult,
  type FinishTaskOptions,
} from './tasks.js';

// Task EventBridge contract: trigger a run ("Run Agent Task") and announce its
// result ("Agent Task Completed"), mirroring the session-request handoff.
export {
  requestAgentTask,
  emitTaskCompleted,
  TASK_EVENT_SOURCE,
  TASK_REQUEST_DETAIL_TYPE,
  TASK_COMPLETED_DETAIL_TYPE,
  type TaskRequestDetail,
  type TaskCompletedDetail,
  type RequestAgentTaskOptions,
  type EmitTaskCompletedOptions,
} from './task-events.js';

// In-memory result cache (dependency-free accelerator; source of truth stays the
// durable row + event).
export {
  TaskResultCache,
  type TaskResultCacheOptions,
} from '../task-cache.js';
