import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import type { RequestContext } from 'bedrock-agentcore/runtime';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import {
  createAssistant,
  handleUserMessage,
  handleTask,
  getSessionConfig,
  resolveTools,
  startTask,
  finishTask,
  toTaskResult,
  emitTaskCompleted,
  TaskResultCache,
  type McpServerSpec,
  type ServerMessage,
  type ToolRegistry,
  type Principal,
  type AgentTaskResult,
} from '@readysetcloud/agent';
import { McpClient, MemoryManager, tool } from '@strands-agents/sdk';
import type { Agent, McpServerConfig } from '@strands-agents/sdk';
// Experimental subpath (pinned exact at bedrock-agentcore 0.4.0): AgentCore
// Memory as a set of Strands MemoryStores.
import { createAgentCoreMemoryStores } from 'bedrock-agentcore/experimental/memory/strands';

// The AgentCore Runtime artifact. Hosts the portable @readysetcloud/agent
// assistant behind AgentCore's WebSocket endpoint (/ws), preserving the exact
// wire protocol so the @readysetcloud/ui/chat client is unchanged.
//
// Deployed to AgentCore Runtime as a NODE_22 arm64 CodeZip bundle (see
// build.mjs + scripts/package-agent.mjs).

// Legacy fallback: a presign-style caller could pass the user id as a custom
// header; AgentCore forwards Custom-* headers to the runtime (lower-cased).
const CUSTOM_USER_ID_HEADER = 'x-amzn-bedrock-agentcore-runtime-custom-user-id';

/**
 * Decodes (does NOT verify) a JWT's `sub`. AgentCore's inbound JWT authorizer
 * (AuthorizerConfiguration in template.yaml) has already validated the token's
 * issuer, signature, and expiry against the shared Cognito pool before the
 * request reaches this runtime — the runtime is behind that boundary and is only
 * reachable through the AgentCore data plane, so it just reads the claim.
 */
function decodeJwtSub(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The verified caller id. Primary source is the Cognito JWT that AgentCore
 * Inbound Auth validated and forwards as the Authorization header — the runtime
 * SDK filters incoming headers to Authorization + Custom-* (see
 * bedrock-agentcore RequestContext). Falls back to the custom user-id header for
 * the debug/HTTP path or a caller that still sets it explicitly.
 */
function getUserId(context: RequestContext): string | undefined {
  const authKey = Object.keys(context.headers).find(
    (h) => h.toLowerCase() === 'authorization',
  );
  const authHeader = authKey ? context.headers[authKey] : undefined;
  if (authHeader) {
    const sub = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, ''));
    if (sub) return sub;
  }

  const direct = context.headers[CUSTOM_USER_ID_HEADER];
  if (direct) return direct;
  // Be tolerant of header-casing differences across AgentCore versions.
  const key = Object.keys(context.headers).find((h) =>
    h.toLowerCase().endsWith('custom-user-id'),
  );
  return key ? context.headers[key] : undefined;
}

// First-party tools this host offers for session selection. A session enables a
// tool by adding its name to `tools` in the session config; unknown names are
// skipped. Register your own tools here — SELECTING a tool per session is a data
// operation (no redeploy); only AUTHORING a new one needs a code change. This
// composes with external MCP tools, which are attached alongside these.
const TOOL_REGISTRY: ToolRegistry = {
  get_current_time: () =>
    tool({
      name: 'get_current_time',
      description: 'Returns the current server time as an ISO-8601 string.',
      inputSchema: z.object({}),
      callback: async () => new Date().toISOString(),
    }),
};

/**
 * Maps a session's declarative MCP specs to the Strands SDK's connection config,
 * folding each spec's authority-minted `authHeader` into the outbound HTTP
 * headers (rsc-core issue #197). The header carries the verified user's identity
 * to the MCP server: the authority (session creator) signs the identity/scope
 * server-side and stores the token on the spec; this runtime is a dumb courier
 * that forwards it verbatim and never interprets it.
 *
 * `authHeader` is applied AFTER the user-supplied `headers`, so a session's own
 * headers can't shadow the identity header. The token value is opaque (base64url
 * payload + signature) and contains no `${...}`, so the SDK's env interpolation
 * over header values leaves it untouched — it is passed through literally.
 */
function toMcpServerConfigs(
  specs: Record<string, McpServerSpec>,
): Record<string, McpServerConfig> {
  const configs: Record<string, McpServerConfig> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const { authHeader, ...rest } = spec;
    if (authHeader?.name) {
      rest.headers = { ...rest.headers, [authHeader.name]: authHeader.value };
    }
    configs[name] = rest as McpServerConfig;
  }
  return configs;
}

// The AWS::BedrockAgentCore::Memory resource id (template.yaml). When unset
// (local/test), the assistant runs without cross-session memory.
const MEMORY_ID = process.env.AGENT_MEMORY_ID;

/**
 * Builds a Strands `MemoryManager` backed by AgentCore Memory for one
 * (user, session). `actorId` is the **verified** user, so memory is scoped per
 * user and never leaks across tenants — the same isolation rule the old
 * user-scoped recall tool enforced.
 *
 * The read namespaces mirror the strategy `Namespaces` on the Memory resource
 * (`/facts/{actorId}`, `/users/{actorId}/preferences`); `{actorId}` is resolved
 * to `userId` here. Exactly one store is writable (`/facts`) — `createEvent` is
 * namespace-free, so one write per turn feeds every strategy's extraction
 * server-side. `MemoryManager` defaults do the rest: automatic context injection
 * on each user turn + a `search_memory` tool (no agent-driven writes; extraction
 * is the only write path).
 *
 * Returns undefined when memory isn't configured (no `AGENT_MEMORY_ID`) or there
 * is no verified user to scope to.
 */
function buildMemoryManager(
  userId: string | undefined,
  sessionId: string,
): MemoryManager | undefined {
  if (!MEMORY_ID || !userId) return undefined;

  const stores = createAgentCoreMemoryStores({
    memoryId: MEMORY_ID,
    actorId: userId,
    sessionId,
    namespaces: [
      { namespace: `/facts/${userId}`, writable: true },
      { namespace: `/users/${userId}/preferences` },
    ],
    extraction: true,
  });

  return new MemoryManager({ stores });
}

/** Best-effort disconnect of a session's MCP clients (never throws). */
async function closeMcpClients(clients: McpClient[]): Promise<void> {
  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.disconnect();
      } catch {
        // cleanup is best-effort
      }
    }),
  );
}

/**
 * Builds the assistant for a session by loading its stored config and applying
 * it — so this generic runtime never needs a redeploy to change agent behavior.
 *
 * - **Ownership:** if a config row exists, the verified connecting user must
 *   match its owner, otherwise a leaked/guessed sessionId could resume another
 *   user's conversation. Returns null on mismatch.
 * - **Tools:** first-party tools named in `config.tools` are resolved against
 *   `TOOL_REGISTRY`, and any `config.mcpServers` are connected as external tool
 *   sources. The returned `mcpClients` must be disconnected when the session
 *   ends (see {@link closeMcpClients}).
 * - Missing config falls back to package defaults.
 */
async function buildAgentForSession(
  sessionId: string,
  ownerId: string | undefined,
  options: { enableMemory?: boolean } = {},
): Promise<{ agent: Agent; mcpClients: McpClient[] } | null> {
  const { enableMemory = true } = options;
  const config = await getSessionConfig(sessionId);
  if (config && config.userId !== ownerId) {
    return null;
  }

  const namedTools = resolveTools(config?.tools, TOOL_REGISTRY, { sessionId, userId: ownerId });

  // External tools: connect to any MCP servers the session declared. The specs
  // are validated + host-allowlisted at session-create time (create-session.mjs).
  let mcpClients: McpClient[] = [];
  const mcpServers = config?.mcpServers;
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    mcpClients = await McpClient.loadServers(toMcpServerConfigs(mcpServers));
  }

  const agent = createAssistant({
    sessionId,
    systemPrompt: config?.systemPrompt,
    modelId: config?.modelId,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    tools: [...namedTools, ...mcpClients],
    // Cross-session memory is per verified user. A `system` principal isn't a
    // user, so autonomous system tasks opt out (enableMemory=false) rather than
    // scope memory to a service id.
    memoryManager: enableMemory ? buildMemoryManager(ownerId, sessionId) : undefined,
  });

  return { agent, mcpClients };
}

const principalSchema = z.object({
  type: z.enum(['user', 'system']),
  id: z.string(),
});

const invocationSchema = z.object({
  request: z.string(),
  session_id: z.string().optional(),
  user_id: z.string().optional(),
  // Autonomous (non-chat) task mode: presence of task_id routes to the task path
  // (durable row + result event) instead of the buffered debug invoke.
  task_id: z.string().optional(),
  // The identity the task runs as, asserted by the trusted IAM caller (the API
  // Lambda or the "Run Agent Task" event consumer). See getUserId's note on the
  // trust model: for an IAM-invoked autonomous run there is no inbound JWT, so
  // the caller — reachable only by first-party principals — supplies the
  // principal. Falls back to the JWT/debug user id when omitted.
  principal: principalSchema.optional(),
});

// In-process, short-lived cache of finished task results. Serves duplicate
// deliveries / quick polls that land on this warm instance without a Dynamo read;
// the durable row + event remain the source of truth (a miss is always correct).
const taskCache = new TaskResultCache();

/**
 * Resolves the identity an autonomous task runs as. Prefers the explicit
 * `principal` the trusted caller asserted; falls back to the verified JWT user
 * (or req.user_id on the debug/local path) as a `user` principal. Undefined when
 * no identity can be determined.
 */
function resolveTaskPrincipal(
  req: { principal?: Principal; user_id?: string },
  context: RequestContext,
): Principal | undefined {
  if (req.principal) return req.principal;
  const userId = getUserId(context) ?? req.user_id;
  return userId ? { type: 'user', id: userId } : undefined;
}

/** The runtime's task-mode return shape: the public result envelope + session. */
type TaskInvocationResponse = AgentTaskResult & { session_id: string };

/**
 * Runs one autonomous task to completion, owning its full durable lifecycle
 * independently of whether a synchronous caller is still waiting on the
 * invocation:
 *
 * 1. Warm-cache + durable claim make the run idempotent under at-least-once
 *    "Run Agent Task" delivery — a duplicate never re-runs the agent (or its
 *    tools). Exactly one invocation claims the task; the rest return the existing
 *    result or report it in flight.
 * 2. The claiming invocation builds the agent for the principal (user tasks reuse
 *    session ownership + cross-session memory; system tasks run stateless), runs
 *    the buffered turn, and records COMPLETED/FAILED.
 * 3. It always emits "Agent Task Completed" and caches the result — so the
 *    outcome reaches async consumers over the bus even if the API already
 *    returned 202 to a caller who stopped waiting past the ~29s REST timeout.
 */
async function runAutonomousTask(
  req: {
    request: string;
    task_id: string;
    session_id?: string;
    principal?: Principal;
    user_id?: string;
  },
  context: RequestContext,
): Promise<TaskInvocationResponse> {
  const taskId = req.task_id;
  // A one-shot task with no caller-supplied session still needs a session id for
  // snapshot storage; derive a stable per-task one so a retry reuses it.
  const sessionId = req.session_id ?? `task-${taskId}`;

  const principal = resolveTaskPrincipal(req, context);
  if (!principal) {
    // Caller error: nothing was claimed and there's no one to attribute an event
    // to. Return a failed envelope inline without writing a row.
    return { taskId, status: 'FAILED', error: 'No principal for task', session_id: sessionId };
  }

  // Fast path: a duplicate/poll on this warm instance skips Dynamo entirely.
  const cached = taskCache.get(taskId);
  if (cached) return { ...cached, session_id: sessionId };

  // Durable exclusive claim — the real idempotency guard.
  const claim = await startTask({
    taskId,
    principal,
    request: req.request,
    ...(req.session_id ? { sessionId: req.session_id } : {}),
  });
  if (!claim.claimed) {
    const existing = claim.existing;
    const result: AgentTaskResult = existing ? toTaskResult(existing) : { taskId, status: 'RUNNING' };
    // Cache only terminal outcomes; a still-RUNNING peer will finish + emit.
    if (existing && (existing.status === 'COMPLETED' || existing.status === 'FAILED')) {
      taskCache.set(result);
    }
    return { ...result, session_id: sessionId };
  }

  let built: { agent: Agent; mcpClients: McpClient[] } | null = null;
  let result: AgentTaskResult;
  try {
    built = await buildAgentForSession(sessionId, principal.id, {
      enableMemory: principal.type === 'user',
    });
    if (!built) {
      result = await finishTask({
        taskId,
        status: 'FAILED',
        error: 'Session does not belong to this principal',
      });
    } else {
      // handleTask flushes memory at the turn boundary; we just close MCP below.
      const output = await handleTask(built.agent, { request: req.request });
      result = await finishTask({ taskId, status: 'COMPLETED', output });
    }
  } catch (err) {
    context.log.error({ err, taskId }, 'Autonomous task failed');
    result = await finishTask({
      taskId,
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    if (built) await closeMcpClients(built.mcpClients);
  }

  // Cache + announce on every outcome so async consumers are uniform.
  taskCache.set(result);
  await emitTaskCompleted({ result, principal });

  return { ...result, session_id: sessionId };
}

const app = new BedrockAgentCoreApp({
  // The HTTP entrypoint is required even though the browser uses the
  // WebSocket. It doubles as a non-streaming/debug path and returns the
  // buffered response.
  invocationHandler: {
    requestSchema: invocationSchema,
    process: async (req, context) => {
      // Autonomous (non-chat) task: durable row + result event. This is the
      // entry point a first-party caller (POST /agent/tasks Lambda, or the
      // "Run Agent Task" event consumer) invokes over the AgentCore data plane.
      if (req.task_id) {
        return runAutonomousTask({ ...req, task_id: req.task_id }, context);
      }

      // Debug/non-streaming invoke (no task tracking) — the original buffered path.
      const sessionId = req.session_id ?? context.sessionId;
      // Verified JWT identity wins; req.user_id is only a local/debug fallback.
      const userId = getUserId(context) ?? req.user_id;
      const built = await buildAgentForSession(sessionId, userId);
      if (!built) {
        return {
          request: req.request,
          response: 'Session does not belong to this user.',
          session_id: sessionId,
        };
      }
      try {
        const result = await built.agent.invoke(req.request);
        return { request: req.request, response: result.toString(), session_id: sessionId };
      } finally {
        // Persist any buffered memory before tearing down (no-op without memory).
        await built.agent.memoryManager?.flush();
        await closeMcpClients(built.mcpClients);
      }
    },
  },

  // Real-time streaming path. Keeps one connection open for a multi-turn
  // conversation, recreating the agent when the client switches sessions.
  websocketHandler: async (socket: WebSocket, context: RequestContext) => {
    const userId = getUserId(context);
    let agent: Agent | null = null;
    let sessionId: string | null = null;
    let mcpClients: McpClient[] = [];

    const send = (message: ServerMessage) => socket.send(JSON.stringify(message));

    context.log.info({ userId, sessionId: context.sessionId }, 'WebSocket connected');

    socket.on('message', async (raw: Buffer) => {
      let data: { request?: string; session_id?: string; user_id?: string };
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', error: 'Invalid JSON in request' });
        return;
      }

      const request = data.request;
      const msgSessionId = data.session_id;
      // Identity is the Cognito `sub` from the JWT that AgentCore Inbound Auth
      // validated for this connection (captured once at connect time). The
      // client-supplied data.user_id is ignored — it can no longer be trusted or
      // needed now that the connection carries a verified bearer token.

      if (!request) {
        send({ type: 'error', error: 'Missing required field: request' });
        return;
      }
      if (!msgSessionId) {
        send({ type: 'error', error: 'Missing required field: session_id' });
        return;
      }

      try {
        // Build the agent on first message, or rebuild when the session changes,
        // loading that session's stored config, tools, and MCP servers and
        // enforcing ownership. Disconnect the previous session's MCP clients.
        if (agent === null || msgSessionId !== sessionId) {
          const built = await buildAgentForSession(msgSessionId, userId);
          if (!built) {
            send({ type: 'error', error: 'Session does not belong to this user' });
            return;
          }
          await closeMcpClients(mcpClients);
          sessionId = msgSessionId;
          agent = built.agent;
          mcpClients = built.mcpClients;
        }

        // handleUserMessage flushes memory per turn, so durability doesn't
        // depend on a clean socket close (AgentCore may reclaim the runtime
        // between turns).
        await handleUserMessage(agent, { request, sessionId, send });
      } catch (err) {
        context.log.error({ err }, 'Error handling message');
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
          message: 'An error occurred while processing your request',
        });
      }
    });

    socket.on('close', () => {
      // Backstop flush (per-turn flush already covers the common case).
      void agent?.memoryManager?.flush();
      void closeMcpClients(mcpClients);
      context.log.info({ sessionId }, 'WebSocket closed');
    });
  },
});

app.run();
