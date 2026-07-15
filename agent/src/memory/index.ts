// Strands-free memory subpath (@readysetcloud/agent/memory).
//
// Lambda consumers (e.g. the DynamoDB-stream vectorizer) need only the memory
// data plane. Importing the package root would transitively load the Strands
// SDK (via agent.ts) and its optional integrations — unnecessary weight and a
// bundling hazard. This barrel exposes just the memory modules, none of which
// have a runtime dependency on @strands-agents/sdk (the snapshot storage uses
// type-only imports, which are erased at build).

export {
  putMemoryTurns,
  recallMemory,
  deleteMemoryKeys,
  memoryVectorKey,
  type MemoryTurn,
  type RecalledMemory,
} from './vector-memory.js';
export { recordTurn, turnKey, TURN_ENTITY, type TurnRow } from './turns.js';
export { embedText, EMBEDDING_DIMENSIONS } from './embeddings.js';
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
