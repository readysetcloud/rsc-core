import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { randomUUID } from 'crypto';

/**
 * Generates an AWS SigV4 presigned WebSocket URL so the browser can connect
 * directly to the AgentCore Runtime that hosts @readysetcloud/agent.
 *
 *   1. The caller is authenticated by the shared Cognito pool (CoreApi JWT
 *      authorizer). The verified `sub` is the identity — never the body.
 *   2. This function signs a wss:// URL with the Lambda execution role (SigV4).
 *   3. The browser connects with the presigned URL (no custom headers needed).
 *      When PROXY_WSS_HOST is set, that URL points at the CloudFront reverse
 *      proxy (chat.<domain>) rather than the raw bedrock-agentcore host, so the
 *      account id in the runtime ARN never reaches the client. See the wsUrl
 *      construction below and ChatProxyDistribution in template.yaml.
 *   4. The verified user id rides along as a Custom-* query param, surfaced to
 *      the agent as the x-amzn-bedrock-agentcore-runtime-custom-user-id header,
 *      so memory recall is scoped to the real caller.
 *
 * The SigV4 presign is hand-rolled (rather than pulling in the bedrock-agentcore
 * runtime SDK, which bundles Fastify) to keep this Lambda dependency-light.
 * Based on the official AWS bi-directional-streaming sample.
 */

const EXPIRES_IN_SECONDS = 300;

/** AWS-compatible URI escaping: encodeURIComponent plus !'()* per RFC 3986. */
const escapeUri = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

/**
 * Builds the query string from a signed HttpRequest. SignatureV4.presign()
 * stores raw (unencoded) query values, so we encode keys and values here.
 */
const buildQueryString = (query) => {
  const parts = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    const encodedKey = escapeUri(key);
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodedKey}=${escapeUri(v)}`);
    } else if (value != null) {
      parts.push(`${encodedKey}=${escapeUri(value)}`);
    } else {
      parts.push(encodedKey);
    }
  }
  return parts.join('&');
};

export const handler = async (event) => {
  try {
    const userId = event.requestContext?.authorizer?.claims?.sub ?? event.requestContext?.authorizer?.jwt?.claims?.sub;
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

    // wss://bedrock-agentcore.<region>.amazonaws.com/runtimes/<arn>/ws
    // The ARN sits raw in the path; SigV4 handles canonical path encoding.
    const wsHost = `bedrock-agentcore.${region}.amazonaws.com`;
    const wsPath = `/runtimes/${runtimeArn}/ws`;

    const query = {
      qualifier: 'DEFAULT',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
      // Pass the verified user id to the agent as a custom header query param.
      'X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Id': userId
    };

    const request = new HttpRequest({
      method: 'GET',
      protocol: 'https:',
      hostname: wsHost,
      path: wsPath,
      headers: { host: wsHost },
      query
    });

    const signer = new SignatureV4({
      service: 'bedrock-agentcore',
      region,
      credentials: defaultProvider(),
      sha256: Sha256
    });

    const signedRequest = await signer.presign(request, {
      expiresIn: EXPIRES_IN_SECONDS,
      signingDate: new Date()
    });

    const queryString = buildQueryString(signedRequest.query);

    // The signature is bound to the bedrock-agentcore host + /runtimes/<arn>/ws
    // path signed above; the query string (X-Amz-Signature and friends) is what
    // authorizes the connection and never changes below.
    //
    // With PROXY_WSS_HOST set, the browser connects through the CloudFront
    // reverse proxy at chat.<domain> instead of the raw AgentCore host. The proxy
    // is configured (template.yaml, ChatProxyDistribution) to prepend
    // /runtimes/<arn> via OriginPath and restore the bedrock-agentcore Host
    // header, so this same signature still validates at the runtime — while the
    // browser only ever sees "/ws" and the account id in the ARN stays hidden.
    // Region is unavoidably present inside X-Amz-Credential (a property of every
    // presigned URL), but it is not sensitive.
    //
    // Without PROXY_WSS_HOST (no custom domain deployed), the browser connects
    // straight to the runtime with the full signed host and path.
    const proxyHost = process.env.PROXY_WSS_HOST;
    const wsUrl = proxyHost
      ? `wss://${proxyHost}/ws?${queryString}`
      : `wss://${signedRequest.hostname}${signedRequest.path}?${queryString}`;

    return response(200, { wsUrl, sessionId, userId, expiresIn: EXPIRES_IN_SECONDS });
  } catch (error) {
    console.error('Failed to generate presigned WebSocket URL', error);
    return response(500, {
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to generate presigned WebSocket URL'
    });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});
