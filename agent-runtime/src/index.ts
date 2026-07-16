import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import type { RequestContext } from 'bedrock-agentcore/runtime';
import type { WebSocket } from '@fastify/websocket';
import { z } from 'zod';
import {
  createAssistant,
  handleUserMessage,
  getSessionConfig,
  resolveTools,
  type McpServerSpec,
  type ServerMessage,
  type ToolRegistry,
} from '@readysetcloud/agent';
import { McpClient, tool } from '@strands-agents/sdk';
import type { Agent, McpServerConfig } from '@strands-agents/sdk';

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
  userId: string | undefined,
): Promise<{ agent: Agent; mcpClients: McpClient[] } | null> {
  const config = await getSessionConfig(sessionId);
  if (config && config.userId !== userId) {
    return null;
  }

  const namedTools = resolveTools(config?.tools, TOOL_REGISTRY, { sessionId, userId });

  // External tools: connect to any MCP servers the session declared. The specs
  // are validated + host-allowlisted at session-create time (create-session.mjs).
  let mcpClients: McpClient[] = [];
  const mcpServers = config?.mcpServers;
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    mcpClients = await McpClient.loadServers(toMcpServerConfigs(mcpServers));
  }

  const agent = createAssistant({
    sessionId,
    userId,
    systemPrompt: config?.systemPrompt,
    modelId: config?.modelId,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    tools: [...namedTools, ...mcpClients],
  });

  return { agent, mcpClients };
}

const invocationSchema = z.object({
  request: z.string(),
  session_id: z.string().optional(),
  user_id: z.string().optional(),
});

const app = new BedrockAgentCoreApp({
  // The HTTP entrypoint is required even though the browser uses the
  // WebSocket. It doubles as a non-streaming/debug path and returns the
  // buffered response.
  invocationHandler: {
    requestSchema: invocationSchema,
    process: async (req, context) => {
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

        await handleUserMessage(agent, { request, sessionId, userId, send });
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
      void closeMcpClients(mcpClients);
      context.log.info({ sessionId }, 'WebSocket closed');
    });
  },
});

app.run();
