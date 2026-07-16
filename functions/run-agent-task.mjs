import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

const client = new BedrockAgentCoreClient({});

/**
 * Consumes "Run Agent Task" events and invokes the AgentCore runtime to run the
 * task inside the secure environment. The runtime owns the whole durable
 * lifecycle (claim → run → finish) and emits "Agent Task Completed"; this
 * consumer just triggers it. Running the agent through the runtime — not here —
 * is the point: the task inherits the same Bedrock access, MCP allowlist, memory
 * scoping, and identity handling as the chat path.
 *
 * Idempotency: EventBridge is at-least-once, but the runtime's conditional claim
 * (startTask) makes a duplicate invocation a no-op, so re-delivery is harmless.
 *
 * Identity: an IAM-invoked runtime call carries no inbound JWT, so we forward the
 * event's `principal` in the payload. The default bus is account-internal, so the
 * emitter is a first-party app trusted to assert that principal — the same trust
 * model as the "Create Agent Session" handoff (create-session-from-event.mjs).
 */
export const handler = async (event) => {
  const detail = event?.detail;
  if (!detail?.taskId || !detail?.request || !detail?.principal?.id) {
    console.error('Run Agent Task event missing required fields; ignoring', { id: event?.id });
    return;
  }

  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  if (!runtimeArn) {
    throw new Error('AGENT_RUNTIME_ARN environment variable is not set');
  }

  const payload = {
    request: detail.request,
    task_id: detail.taskId,
    principal: detail.principal,
    ...(detail.sessionId ? { session_id: detail.sessionId } : {}),
    ...(detail.systemPrompt !== undefined ? { system_prompt: detail.systemPrompt } : {}),
  };

  await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    qualifier: 'DEFAULT',
    // A stable per-task runtime session id keeps a retry affinity-routed to the
    // same warm instance (and clears AgentCore's session-id length minimum).
    runtimeSessionId: `task-${detail.taskId}`,
    contentType: 'application/json',
    payload: new TextEncoder().encode(JSON.stringify(payload)),
  }));
};
