import { randomUUID } from 'node:crypto';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventBridge } from '../aws/events.js';
import { createSession, type CreateSessionOptions, type SessionConfig } from './sessions.js';

// An async, event-driven way to create a session — the counterpart to
// `createSession` (which writes DynamoDB directly). A separate app (a different
// stack) that wants an agent session emits a "Create Agent Session" event on the
// default EventBridge bus; the stack that OWNS the agent table subscribes and
// runs `createSessionFromEvent`. This keeps the config row in the agent's own
// table without granting the requesting app cross-stack table access — it needs
// only `events:PutEvents` on the default bus. It mirrors the ecosystem's
// existing "Track Activity" (Badge Chest) handoff.
//
// Session creation is async, but that's a fit: the runtime reads a session's
// config only when the first message arrives (well after the requester got its
// sessionId back), so the row lands before it's needed. A missing row falls back
// to package defaults, so an unusually slow write degrades rather than errors.

/** EventBridge `source` for the session-request event. */
export const SESSION_REQUEST_SOURCE = 'readysetcloud.agent';
/** EventBridge `detail-type` for the session-request event. */
export const SESSION_REQUEST_DETAIL_TYPE = 'Create Agent Session';

/** The `detail` payload of a session-request event. Mirrors {@link CreateSessionOptions}. */
export interface SessionRequestDetail {
  sessionId: string;
  userId: string;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  mcpServers?: CreateSessionOptions['mcpServers'];
  title?: string;
}

/** Options for {@link requestSession}: the session config, plus an optional bus override. */
export type RequestSessionOptions = CreateSessionOptions & {
  /** EventBridge bus to publish to; defaults to the account's `default` bus. */
  eventBusName?: string;
};

/**
 * Requests a session by emitting a "Create Agent Session" event, and returns the
 * `sessionId` immediately (generated here if not supplied) so the caller can
 * presign a connection right away. The owning stack's consumer creates the
 * config row from the event. The caller needs only `events:PutEvents`.
 */
export async function requestSession(options: RequestSessionOptions): Promise<{ sessionId: string }> {
  const { userId } = options;
  if (!userId) throw new Error('requestSession requires a userId');

  const sessionId = options.sessionId ?? randomUUID();
  const detail: SessionRequestDetail = {
    sessionId,
    userId,
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.mcpServers !== undefined ? { mcpServers: options.mcpServers } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
  };

  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: SESSION_REQUEST_SOURCE,
      DetailType: SESSION_REQUEST_DETAIL_TYPE,
      Detail: JSON.stringify(detail),
      ...(options.eventBusName ? { EventBusName: options.eventBusName } : {}),
    }],
  }));

  return { sessionId };
}

/**
 * Creates a session's config row from a received session-request event detail —
 * the consumer side, run by the stack that owns the agent table. Thin wrapper
 * over {@link createSession} that carries the requester-chosen `sessionId`
 * through, so the row matches the id the requester already returned to its
 * client.
 */
export async function createSessionFromEvent(detail: SessionRequestDetail): Promise<SessionConfig> {
  if (!detail?.userId) throw new Error('session-request event is missing userId');
  if (!detail?.sessionId) throw new Error('session-request event is missing sessionId');
  return createSession({
    userId: detail.userId,
    sessionId: detail.sessionId,
    systemPrompt: detail.systemPrompt,
    modelId: detail.modelId,
    temperature: detail.temperature,
    maxTokens: detail.maxTokens,
    tools: detail.tools,
    mcpServers: detail.mcpServers,
    title: detail.title,
  });
}
