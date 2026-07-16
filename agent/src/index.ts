// Public API of @readysetcloud/agent.

// Assistant factory + turn orchestration.
export {
  createAssistant,
  handleUserMessage,
  type CreateAssistantOptions,
  type HandleUserMessageOptions,
} from './agent.js';

// Autonomous (non-chat) task orchestration — the buffered sibling of
// handleUserMessage.
export {
  handleTask,
  type HandleTaskOptions,
} from './task.js';

// Wire protocol (shared with the UI client).
export type {
  ServerMessage,
  ClientMessage,
  AgentStreamEventBody,
  SendMessage,
} from './protocol.js';

// Streaming primitives (exposed for custom hosts + testing).
export {
  streamTurn,
  toStreamEventBodies,
  type StrandsStream,
  type StrandsStreamEvent,
  type StreamTurnOptions,
} from './stream.js';

// Memory: snapshot persistence for within/across-connection conversation
// continuity. Cross-session semantic memory is provided by the Strands
// `memoryManager` (AgentCore Memory), wired by the host — not exported here.
export { DynamoSnapshotStorage } from './memory/dynamo-snapshot-storage.js';

// Session configuration (per-session prompt/model/tools, loaded by the runtime).
export {
  createSession,
  getSessionConfig,
  SESSION_CONFIG_ENTITY,
  type SessionConfig,
  type CreateSessionOptions,
  type McpServerSpec,
} from './memory/sessions.js';

// Event-driven session creation (a separate stack requests a session over the
// default bus; the owning stack consumes it). See ./memory/session-events.
export {
  requestSession,
  createSessionFromEvent,
  SESSION_REQUEST_SOURCE,
  SESSION_REQUEST_DETAIL_TYPE,
  type SessionRequestDetail,
  type RequestSessionOptions,
} from './memory/session-events.js';

// Autonomous task records + EventBridge contract + in-memory result cache. Also
// on the Strands-free ./memory subpath for Lambda consumers.
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
} from './memory/tasks.js';
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
} from './memory/task-events.js';
export {
  TaskResultCache,
  type TaskResultCacheOptions,
} from './task-cache.js';

// Tools.
export {
  resolveTools,
  type ToolRegistry,
  type ToolFactory,
  type ToolContext,
  type AgentTool,
} from './tools/registry.js';

// Configuration constants.
export {
  DEFAULT_MODEL_ID,
  DEFAULT_REGION,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
} from './config.js';
