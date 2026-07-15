// Public API of @readysetcloud/agent.

// Assistant factory + turn orchestration.
export {
  createAssistant,
  handleUserMessage,
  type CreateAssistantOptions,
  type HandleUserMessageOptions,
} from './agent.js';

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

// Memory: snapshot persistence, turn recording, and semantic recall.
export { DynamoSnapshotStorage } from './memory/dynamo-snapshot-storage.js';
export { recordTurn, turnKey, TURN_ENTITY, type TurnRow } from './memory/turns.js';
export {
  putMemoryTurns,
  recallMemory,
  deleteMemoryKeys,
  memoryVectorKey,
  type MemoryTurn,
  type RecalledMemory,
} from './memory/vector-memory.js';
export { embedText, EMBEDDING_DIMENSIONS } from './memory/embeddings.js';

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

// Tools.
export { createRecallMemoryTool } from './tools/recall-memory.js';
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
