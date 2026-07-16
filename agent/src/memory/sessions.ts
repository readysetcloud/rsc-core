import { randomUUID } from 'node:crypto';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireTableName } from '../aws/ddb.js';

// Per-session agent configuration, stored in the single table so the deployed
// AgentCore runtime stays a GENERIC host: it uploads its code once, then loads
// each session's prompt/model/params from here at connect time. Changing how an
// agent behaves is a data operation (create a session), never a redeploy.
//
//   pk = SESSION#{sessionId}
//   sk = CONFIG
//   entity = "SessionConfig"
//
// The row shares the session's partition with its Strands snapshots
// (sk=SNAPSHOT#…), so a session's config and history live together. `userId` is
// the creating caller; the runtime enforces that the verified connecting user
// matches it before loading the config or resuming history — so a leaked/guessed
// sessionId can't be used to hijack another user's prompt or conversation.

/** DynamoDB `entity` discriminator for a session-config row. */
export const SESSION_CONFIG_ENTITY = 'SessionConfig';

// Mirror the 30-day retention of turns/snapshots.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A declarative, JSON-serializable pointer to an external MCP server whose tools
 * a session wants. Mirrors the serializable subset of the Strands SDK's
 * `McpServerConfig`; the host maps it through `McpClient.loadServers()`. Kept as
 * a local type so this module (and the `./memory` subpath) stay free of any
 * `@strands-agents/sdk` dependency. `${VAR}` / `${env:VAR}` interpolation in
 * string fields is resolved by the SDK against the host's environment, so
 * secrets live in the runtime env — not in this row.
 */
export interface McpServerSpec {
  /** Server endpoint (streamable-http or SSE transport). */
  url?: string;
  /** HTTP headers sent with every request. */
  headers?: Record<string, string>;
  /**
   * An authority-minted credential that travels with the session and identifies
   * the verified connecting user to this MCP server. The session's creator (a
   * trusted authority, server-side) signs the user's identity/scope and stores
   * the resulting token here; the runtime forwards it verbatim as an outbound
   * HTTP header on every request to this server, letting the server authenticate
   * that the caller is the shared runtime and learn which user is asking (so it
   * can scope retrieval to that user's tenant). See rsc-core issue #197.
   *
   * Distinct from {@link headers} on purpose: `headers` is user-supplied and
   * subject to `${VAR}` interpolation, whereas this is an authority credential
   * the runtime passes through literally (no interpolation) and applies last, so
   * a session's own headers can't shadow it. Unlike other secrets, this one may
   * live in the config row because it is bound to the session, revocable by the
   * authority, and only grants a read of the user's own content.
   */
  authHeader?: {
    /** Outbound header name the MCP server expects (authority-chosen). */
    name: string;
    /** Opaque authority-minted token (e.g. `<base64url(payload)>.<sig>`). */
    value: string;
  };
  /** Explicit transport; auto-detected from the fields present when omitted. */
  transport?: 'stdio' | 'sse' | 'streamable-http';
  /** Command to spawn (stdio transport). */
  command?: string;
  /** Arguments passed to the spawned command. */
  args?: string[];
  /** Environment variables for the spawned command. */
  env?: Record<string, string>;
  /** Skip this server when loading. */
  disabled?: boolean;
  /** Skip (rather than throw) on this server's config/connection failure. */
  continueOnError?: boolean;
}

/**
 * Per-session agent configuration, loaded by the runtime at connect. Everything
 * here is data: prompt/model/params, a selection of first-party tools by name,
 * and external MCP servers — so a generic host changes its behavior without a
 * redeploy.
 */
export interface SessionConfig {
  /** The session id this config belongs to. */
  sessionId: string;
  /** Verified owner. The runtime refuses the session for any other caller. */
  userId: string;
  /** System prompt override; defaults to `DEFAULT_SYSTEM_PROMPT`. */
  systemPrompt?: string;
  /** Chat model id override; defaults to `DEFAULT_MODEL_ID`. */
  modelId?: string;
  /** Sampling temperature override; defaults to `DEFAULT_TEMPERATURE`. */
  temperature?: number;
  /** Max response tokens override; defaults to `DEFAULT_MAX_TOKENS`. */
  maxTokens?: number;
  /** First-party tool names to enable, resolved against the host's registry. */
  tools?: string[];
  /** External MCP servers whose tools to attach, keyed by a label. */
  mcpServers?: Record<string, McpServerSpec>;
  /** Optional human label for the conversation. */
  title?: string;
  /** Epoch millis the session was created. */
  createdAt: number;
}

/** Options for {@link createSession}. Unset fields fall back to package defaults. */
export interface CreateSessionOptions {
  /** Verified caller id; becomes the session owner. Required. */
  userId: string;
  /** Provide to use a specific id; a UUID is generated when omitted. */
  sessionId?: string;
  /** System prompt for this session. */
  systemPrompt?: string;
  /** Chat model id for this session. */
  modelId?: string;
  /** Sampling temperature for this session. */
  temperature?: number;
  /** Max response tokens for this session. */
  maxTokens?: number;
  /** First-party tool names to enable (resolved against the host's registry). */
  tools?: string[];
  /** External MCP servers whose tools to attach. */
  mcpServers?: Record<string, McpServerSpec>;
  /** Optional human label for the conversation. */
  title?: string;
  /** Override the creation timestamp (epoch millis); defaults to `Date.now()`. */
  now?: number;
  /** Table to write to; defaults to the `TABLE_NAME` env var (see `requireTableName`). */
  tableName?: string;
}

function sessionConfigKey(sessionId: string) {
  return { pk: `SESSION#${sessionId}`, sk: 'CONFIG' };
}

/**
 * Creates a session's configuration row and returns it. Unset fields are
 * omitted so the runtime falls back to the package defaults
 * (DEFAULT_SYSTEM_PROMPT / DEFAULT_MODEL_ID / …). The write is conditional on
 * the session not already existing, so an existing session's config (and its
 * owner) can never be overwritten by a later create.
 */
export async function createSession(options: CreateSessionOptions): Promise<SessionConfig> {
  const { userId } = options;
  if (!userId) throw new Error('createSession requires a userId');

  const TableName = requireTableName(options.tableName);
  const now = options.now ?? Date.now();
  const sessionId = options.sessionId ?? randomUUID();

  const config: SessionConfig = {
    sessionId,
    userId,
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.mcpServers !== undefined ? { mcpServers: options.mcpServers } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    createdAt: now,
  };

  await ddb.send(new PutCommand({
    TableName,
    Item: {
      ...sessionConfigKey(sessionId),
      entity: SESSION_CONFIG_ENTITY,
      ...config,
      expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    },
    ConditionExpression: 'attribute_not_exists(pk)',
  }));

  return config;
}

/**
 * Loads a session's configuration, or null if none exists (in which case the
 * caller uses package defaults). Does not enforce ownership — the caller
 * compares `config.userId` against the verified connecting user. Pass
 * `tableName` to read from a specific table; defaults to the `TABLE_NAME` env.
 */
export async function getSessionConfig(
  sessionId: string,
  tableName?: string,
): Promise<SessionConfig | null> {
  if (!sessionId) return null;
  const TableName = requireTableName(tableName);

  const res = await ddb.send(new GetCommand({
    TableName,
    Key: sessionConfigKey(sessionId),
  }));
  if (!res.Item) return null;

  const item = res.Item;
  return {
    sessionId: item.sessionId as string,
    userId: item.userId as string,
    systemPrompt: item.systemPrompt as string | undefined,
    modelId: item.modelId as string | undefined,
    temperature: item.temperature as number | undefined,
    maxTokens: item.maxTokens as number | undefined,
    tools: item.tools as string[] | undefined,
    mcpServers: item.mcpServers as Record<string, McpServerSpec> | undefined,
    title: item.title as string | undefined,
    createdAt: item.createdAt as number,
  };
}
