import { Agent, BedrockModel, SessionManager, type AgentConfig } from '@strands-agents/sdk';
import {
  DEFAULT_MODEL_ID,
  DEFAULT_REGION,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_SYSTEM_PROMPT,
} from './config.js';
import { DynamoSnapshotStorage } from './memory/dynamo-snapshot-storage.js';
import { createRecallMemoryTool } from './tools/recall-memory.js';
import { recordTurn } from './memory/turns.js';
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
  /** Verified caller id; enables the recall_memory tool scoped to this user. */
  userId?: string;
  /** Chat model id; defaults to {@link DEFAULT_MODEL_ID}. */
  modelId?: string;
  /** System prompt; defaults to {@link DEFAULT_SYSTEM_PROMPT}. */
  systemPrompt?: string;
  /** Sampling temperature; defaults to {@link DEFAULT_TEMPERATURE}. */
  temperature?: number;
  /** Max response tokens; defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /**
   * Extra tools to expose alongside recall_memory. Accepts anything the Strands
   * `Agent` does — a `tool()`, an `McpClient`, or a sub-`Agent` — so the host is
   * free to attach first-party, external (MCP), and agent-as-tool capabilities.
   */
  tools?: AgentConfig['tools'];
  /** Inject a storage backend (tests pass a fake); defaults to DynamoDB. */
  storage?: DynamoSnapshotStorage;
}

/**
 * Builds a configured Strands `Agent`: a Bedrock model, a DynamoDB-backed
 * session manager for snapshot persistence, and a tool set of `recall_memory`
 * (added when `userId` is set) plus any `tools` you pass. This is the portable
 * core — it knows nothing about WebSockets, AgentCore, or HTTP. Construct one
 * per session and reuse it across turns on the same connection.
 *
 * @param options See {@link CreateAssistantOptions}.
 * @returns A ready-to-run Strands `Agent`.
 */
export function createAssistant(options: CreateAssistantOptions): Agent {
  const {
    sessionId,
    userId,
    modelId = DEFAULT_MODEL_ID,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    tools = [],
    storage = new DynamoSnapshotStorage(),
  } = options;

  const sessionManager = new SessionManager({
    sessionId,
    storage: { snapshot: storage },
  });

  const assistantTools: NonNullable<AgentConfig['tools']> = [
    ...(userId ? [createRecallMemoryTool(userId)] : []),
    ...(tools ?? []),
  ];

  return new Agent({
    model: new BedrockModel({
      region: DEFAULT_REGION,
      modelId,
      maxTokens,
      temperature,
    }),
    systemPrompt,
    tools: assistantTools,
    sessionManager,
  });
}

/** Options for {@link handleUserMessage}. */
export interface HandleUserMessageOptions {
  /** The user's message text for this turn. */
  request: string;
  /** Conversation/session id the turn belongs to. */
  sessionId: string;
  /** Verified caller id; when set, the turn is recorded for memory. */
  userId?: string;
  /** Callback that pushes each wire-protocol message to the client. */
  send: SendMessage;
}

/**
 * Runs one full turn end-to-end: streams the agent's response to the client
 * over the wire protocol, then records the turn to DynamoDB (which the
 * stream vectorizer turns into semantic memory). Returns the assistant text.
 *
 * The host is expected to construct the agent once per session and reuse it
 * across turns on the same connection.
 */
export async function handleUserMessage(
  agent: Agent,
  { request, sessionId, userId, send }: HandleUserMessageOptions,
): Promise<string> {
  // `agent.stream()` returns an async iterable of Strands events.
  const stream = agent.stream(request) as unknown as StrandsStream;
  const response = await streamTurn(stream, { sessionId, send });

  if (userId) {
    await recordTurn({ userId, sessionId, request, response });
  }

  return response;
}
