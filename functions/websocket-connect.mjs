import { randomUUID } from 'crypto';

/**
 * Returns the wss:// URL the browser uses to open a streaming WebSocket to the
 * AgentCore Runtime that hosts @readysetcloud/agent.
 *
 * Auth is AgentCore **Inbound Auth** (a Cognito JWT), not a SigV4 presigned URL:
 *
 *   1. The caller is authenticated by the shared Cognito pool (CoreApi JWT
 *      authorizer) — this endpoint just needs a signed-in user to hand back a
 *      URL + session id.
 *   2. The runtime is configured with a CustomJWTAuthorizerConfiguration
 *      (template.yaml, AgentCoreRuntime) that validates the caller's Cognito ID
 *      token against the shared user pool. The browser presents that token as an
 *      OAuth bearer in the WebSocket handshake (Sec-WebSocket-Protocol), so the
 *      URL itself carries no credential and needs no signing here.
 *   3. AgentCore forwards the validated token to the runtime as the Authorization
 *      header, from which the runtime reads the verified `sub` — identity is the
 *      real caller, never a client-supplied value (see agent-runtime/src/index.ts).
 *
 * The runtime session id rides as a query param (browsers can't set arbitrary
 * WebSocket handshake headers). This mirrors the AgentCore SDK's own browser
 * OAuth helper (bedrock-agentcore RuntimeClient.connectShellOAuth), which puts
 * X-Amzn-Bedrock-AgentCore-Runtime-Session-Id in the query string and the bearer
 * token in the subprotocol.
 *
 * When PROXY_WSS_HOST is set (custom-domain deploy), the URL points at the
 * CloudFront reverse proxy (chat.<domain>) instead of the raw bedrock-agentcore
 * host, so the account id in the runtime ARN never reaches the client. The proxy
 * forwards the query params and the Sec-WebSocket-Protocol header unchanged and
 * prepends /runtimes/<arn> (OriginPath) — see ChatProxyDistribution in
 * template.yaml.
 */

const SESSION_ID_PARAM = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

export const handler = async (event) => {
  try {
    const userId =
      event.requestContext?.authorizer?.claims?.sub ??
      event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!userId) {
      return response(401, { message: 'Unauthorized' });
    }

    const region = process.env.AWS_REGION;
    const runtimeArn = process.env.AGENT_RUNTIME_ARN;
    if (!runtimeArn) {
      throw new Error('AGENT_RUNTIME_ARN environment variable is not set');
    }

    let body;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return response(400, { message: 'Invalid JSON body' });
    }
    const sessionId = body.sessionId || randomUUID();

    // Base path: proxy hides the account-id-bearing ARN behind chat.<domain>/ws;
    // otherwise the browser connects straight to the runtime's /runtimes/<arn>/ws.
    const proxyHost = process.env.PROXY_WSS_HOST;
    const base = proxyHost
      ? `wss://${proxyHost}/ws`
      : `wss://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(runtimeArn)}/ws`;

    const url = new URL(base);
    url.searchParams.set('qualifier', 'DEFAULT');
    url.searchParams.set(SESSION_ID_PARAM, sessionId);
    const wsUrl = url.toString();

    return response(200, { wsUrl, sessionId });
  } catch (error) {
    console.error('Failed to build agent WebSocket URL', error);
    return response(500, {
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to build agent WebSocket URL'
    });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});
