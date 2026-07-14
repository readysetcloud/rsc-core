import { createSession } from '@readysetcloud/agent/memory';

/**
 * Creates an agent session and returns its id. The caller (verified Cognito
 * sub) becomes the session owner; the AgentCore runtime later refuses the
 * session for any other user, so a leaked sessionId can't be used to resume
 * someone else's conversation.
 *
 * Optional body fields set how this session's agent behaves — systemPrompt,
 * modelId, temperature, maxTokens, title, plus `tools` (first-party tool names
 * the runtime resolves against its registry) and `mcpServers` (external MCP
 * tool sources). All fall back to the @readysetcloud/agent package defaults when
 * omitted, so the deployed runtime never needs a redeploy to change behavior:
 * that is a data operation, done here.
 *
 * MCP servers are the one place a session can point the runtime at an outbound
 * URL, so each host is checked against the MCP_ALLOWED_HOSTS allowlist (an SSRF
 * guard). With the allowlist unset, `mcpServers` is rejected — opt in explicitly.
 */
export const handler = async (event) => {
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return response(401, { message: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return response(400, { message: 'Invalid JSON body' });
  }

  const { systemPrompt, modelId, temperature, maxTokens, title, tools, mcpServers } = body;

  const mcpError = validateMcpServers(mcpServers);
  if (mcpError) {
    return response(400, { message: mcpError });
  }

  try {
    const session = await createSession({
      userId,
      systemPrompt,
      modelId,
      temperature,
      maxTokens,
      title,
      tools,
      mcpServers
    });
    return response(201, { sessionId: session.sessionId, title: session.title ?? null });
  } catch (error) {
    console.error('Failed to create session', error);
    return response(500, { message: 'Failed to create session' });
  }
};

/**
 * Returns an error message if any MCP server url targets a host not on the
 * MCP_ALLOWED_HOSTS allowlist (comma-separated), or null if all are allowed.
 * Prevents an authenticated caller from pointing the public-network runtime at
 * an arbitrary (e.g. internal) endpoint.
 */
const validateMcpServers = (mcpServers) => {
  if (!mcpServers || typeof mcpServers !== 'object') return null;

  const allowed = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  for (const [name, spec] of Object.entries(mcpServers)) {
    if (!spec?.url) continue; // stdio/command servers have no outbound host
    let host;
    try {
      host = new URL(spec.url).host;
    } catch {
      return `Invalid url for MCP server "${name}"`;
    }
    if (!allowed.includes(host)) {
      return `MCP host not allowed: ${host}`;
    }
  }
  return null;
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
