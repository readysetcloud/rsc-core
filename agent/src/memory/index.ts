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
