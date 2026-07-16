import {
  Agent,
  BedrockModel,
  SessionManager,
  type AgentConfig,
  type MemoryManager,
  type MemoryManagerConfig,
} from '@strands-agents/sdk';
import {
  DEFAULT_MODEL_ID,
  DEFAULT_REGION,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_SYSTEM_PROMPT,
} from './config.js';
import { DynamoSnapshotStorage } from './memory/dynamo-snapshot-storage.js';
import { streamTurn, type StrandsStream } from './stream.js';
import type { SendMessage } from './protocol.js';

// The assistant factory + turn orchestration. This is the portable core
// that both an AgentCore Runtime host and any future Lambda-based invoker
// build on. It knows nothing about WebSockets, AgentCore, or HTTP — it just
// produces a configured Strands Agent and runs turns through the
// wire-protocol streamer.

/** Options for {@link createAssistant}. */
export interface CreateAssistantOptions {
  /** Conversation/session id — drives snapshot persistence and multi-turn. */
  sessionId: string;
  /** Chat model id; defaults to {@link DEFAULT_MODEL_ID}. */
  modelId?: string;
  /** System prompt; defaults to {@link DEFAULT_SYSTEM_PROMPT}. */
  systemPrompt?: string;
  /** Sampling temperature; defaults to {@link DEFAULT_TEMPERATURE}. */
  temperature?: number;
  /** Max response tokens; defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /**
   * Tools to expose. Accepts anything the Strands `Agent` does — a `tool()`, an
   * `McpClient`, or a sub-`Agent` — so the host is free to attach first-party,
   * external (MCP), and agent-as-tool capabilities.
   */
  tools?: AgentConfig['tools'];
  /**
   * Cross-session memory. Pass a Strands {@link MemoryManager} (or its config)
   * for recall + automatic prompt injection + extraction. This package is
   * transport-agnostic, so the host builds the backing stores and hands the
   * manager in — in rsc-core the runtime wires AgentCore Memory (see
   * agent-runtime). Omit for a stateless-across-sessions assistant.
   */
  memoryManager?: MemoryManager | MemoryManagerConfig;
  /** Inject a storage backend (tests pass a fake); defaults to DynamoDB. */
  storage?: DynamoSnapshotStorage;
  /**
   * Table for the default snapshot storage; defaults to the `TABLE_NAME` env
   * var. Ignored when an explicit `storage` is provided. Pass it to point a
   * library-mode assistant at its own table.
   */
  tableName?: string;
}

/**
 * Builds a configured Strands `Agent`: a Bedrock model, a DynamoDB-backed
 * session manager for within/across-connection snapshot persistence, an optional
 * cross-session `memoryManager`, and any `tools` you pass. This is the portable
 * core — it knows nothing about WebSockets, AgentCore, or HTTP. Construct one
 * per session and reuse it across turns on the same connection.
 *
 * @param options See {@link CreateAssistantOptions}.
 * @returns A ready-to-run Strands `Agent`.
 */
export function createAssistant(options: CreateAssistantOptions): Agent {
  const {
    sessionId,
    modelId = DEFAULT_MODEL_ID,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    tools = [],
    memoryManager,
    storage = new DynamoSnapshotStorage(options.tableName),
  } = options;

  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: storage },
  });

  return new Agent({
    model: new BedrockModel({
      region: DEFAULT_REGION,
      modelId,
      maxTokens,
      temperature,
    }),
    systemPrompt,
    tools: tools ?? [],
    sessionManager,
    ...(memoryManager ? { memoryManager } : {}),
  });
}

/** Options for {@link handleUserMessage}. */
export interface HandleUserMessageOptions {
  /** The user's message text for this turn. */
  request: string;
  /** Conversation/session id the turn belongs to. */
  sessionId: string;
  /** Callback that pushes each wire-protocol message to the client. */
  send: SendMessage;
}

/**
 * Runs one full turn end-to-end: streams the agent's response to the client
 * over the wire protocol, then flushes the memory manager so the turn is
 * durably captured before we return. Returns the assistant text.
 *
 * If a `memoryManager` is configured, it captures the conversation during the
 * turn (via Strands' plugin lifecycle) and extracts long-term memory in the
 * background. Extraction is fire-and-forget, so we `flush()` at this per-turn
 * boundary to guarantee durability even if the runtime is reclaimed between
 * turns — a chat connection has no reliable shutdown hook. `flush()` is a no-op
 * when no store has extraction configured.
 *
 * The host is expected to construct the agent once per session and reuse it
 * across turns on the same connection.
 */
export async function handleUserMessage(
  agent: Agent,
  { request, sessionId, send }: HandleUserMessageOptions,
): Promise<string> {
  // `agent.stream()` returns an async iterable of Strands events.
  const stream = agent.stream(request) as unknown as StrandsStream;
  const response = await streamTurn(stream, { sessionId, send });

  await agent.memoryManager?.flush();

  return response;
}
