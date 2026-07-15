import { createSessionFromEvent } from '@readysetcloud/agent/memory';

/**
 * Consumes "Create Agent Session" events from the default EventBridge bus and
 * writes the session's config row into AgentChatTable — the owning-stack side of
 * the event-driven session handoff (@readysetcloud/agent `requestSession`).
 *
 * A separate app (e.g. Booked) emits the event with `events:PutEvents`; the
 * config lands here without granting that app cross-stack table access.
 *
 * Trust: the event bus is account-internal, so emitters are first-party app
 * Lambdas — not arbitrary end users like the public POST /agent/sessions
 * endpoint. That endpoint's MCP_ALLOWED_HOSTS SSRF guard is therefore not
 * applied here; if defense-in-depth against a compromised emitter is wanted,
 * re-validate `mcpServers` against the allowlist before creating.
 */
export const handler = async (event) => {
  const detail = event?.detail;
  if (!detail) {
    console.error('Session-request event has no detail; ignoring', { id: event?.id });
    return;
  }

  try {
    await createSessionFromEvent(detail);
  } catch (err) {
    // Conditional create (attribute_not_exists(pk)): a duplicate delivery of the
    // same sessionId throws — the session already exists, which is the desired
    // end state, so treat it as success (idempotent).
    if (err?.name === 'ConditionalCheckFailedException') {
      console.log('Session already exists; ignoring duplicate event', { sessionId: detail.sessionId });
      return;
    }
    // Anything else: log and rethrow so EventBridge retries.
    console.error('Failed to create session from event', { sessionId: detail?.sessionId, err });
    throw err;
  }
};
