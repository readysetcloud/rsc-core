import { z } from 'zod';
import { McpClient, tool } from '@strands-agents/sdk';
import {
  createAssistant,
  resolveTools,
  getSessionConfig,
  runAgentTask,
  TaskResultCache,
} from '@readysetcloud/agent';

/**
 * Consumes "Run Agent Task" events and runs the autonomous (non-chat) agent to
 * completion **in this Lambda**, inside the RSC account (same Bedrock grant, MCP
 * allowlist, and single table as the chat runtime). Tasks do not go through the
 * AgentCore runtime: that runtime uses a Cognito JWT inbound authorizer for the
 * browser, and an AgentCore runtime can be JWT- or IAM-authorized but not both —
 * so an IAM-invoked, no-JWT task call can't reach it. Running the portable
 * @readysetcloud/agent core here avoids that entirely.
 *
 * `runAgentTask` owns the durable lifecycle: a conditional claim (startTask)
 * makes the run idempotent under at-least-once delivery — a duplicate delivery
 * (or a parallel one on another container) never re-runs the agent or its tools —
 * and it records the row + emits "Agent Task Completed" on every outcome.
 *
 * Identity is the event's `principal`, asserted by the first-party emitter (the
 * default bus is account-internal — the same trust model as the "Create Agent
 * Session" handoff). A `user` task is scoped to that sub; a `system` task runs as
 * a service id.
 *
 * v1 scope: tasks are **memory-light** — snapshots give within/continuity for a
 * task tied to a session, but there is no AgentCore cross-session memory here
 * (that dependency lives in the runtime). Add a memoryManager to the assistant if
 * a task ever needs recall of a user's long-term facts/preferences.
 */

// Reuse across warm invocations: a fast idempotency check for a duplicate that
// lands on the same container. The durable claim in runAgentTask is the real
// guard; this is only an accelerator.
const taskCache = new TaskResultCache();

// First-party tools a task may select by name (mirrors the runtime's registry).
// Selecting a tool is a data operation (name it in the session/event `tools`);
// authoring a new one is a code change here.
const TOOL_REGISTRY = {
  get_current_time: () =>
    tool({
      name: 'get_current_time',
      description: 'Returns the current server time as an ISO-8601 string.',
      inputSchema: z.object({}),
      callback: async () => new Date().toISOString(),
    }),
};

/**
 * Maps a session's declarative MCP specs to the Strands connection config,
 * folding each spec's authority-minted `authHeader` into the outbound headers
 * (applied last, so a session's own headers can't shadow the identity header).
 * Mirrors the runtime's toMcpServerConfigs.
 */
const toMcpServerConfigs = (specs) => {
  const configs = {};
  for (const [name, spec] of Object.entries(specs)) {
    const { authHeader, ...rest } = spec;
    if (authHeader?.name) {
      rest.headers = { ...(rest.headers ?? {}), [authHeader.name]: authHeader.value };
    }
    configs[name] = rest;
  }
  return configs;
};

export const handler = async (event) => {
  const detail = event?.detail;
  if (!detail?.taskId || !detail?.request || !detail?.principal?.id) {
    console.error('Run Agent Task event missing required fields; ignoring', { id: event?.id });
    return;
  }

  const { taskId, request, principal, sessionId } = detail;
  // A one-shot task with no caller session still needs a session id for snapshot
  // storage; derive a stable per-task one so a retry reuses it.
  const effectiveSessionId = sessionId ?? `task-${taskId}`;

  // Build the agent only after the claim succeeds (runAgentTask calls this), so a
  // duplicate delivery never loads config or connects MCP servers.
  const buildAgent = async () => {
    const config = sessionId ? await getSessionConfig(sessionId) : null;
    // Ownership: a task can only reuse a session whose owner matches its
    // principal (a user's sub, or a system id that owns a system session).
    if (config && config.userId !== principal.id) {
      throw new Error('Session does not belong to this principal');
    }

    const tools = config?.tools ?? detail.tools;
    const namedTools = resolveTools(tools, TOOL_REGISTRY, { sessionId: effectiveSessionId, userId: principal.id });

    // External tools. For a session, specs were host-allowlisted at create time;
    // for an inline event, the first-party emitter is trusted (account bus).
    let mcpClients = [];
    const mcpServers = config?.mcpServers ?? detail.mcpServers;
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      mcpClients = await McpClient.loadServers(toMcpServerConfigs(mcpServers));
    }

    const agent = createAssistant({
      sessionId: effectiveSessionId,
      systemPrompt: config?.systemPrompt ?? detail.systemPrompt,
      modelId: config?.modelId ?? detail.modelId,
      temperature: config?.temperature ?? detail.temperature,
      maxTokens: config?.maxTokens ?? detail.maxTokens,
      tools: [...namedTools, ...mcpClients],
      // Memory-light (see the file header): no AgentCore cross-session memory here.
    });

    return {
      agent,
      cleanup: () => Promise.all(mcpClients.map((c) => c.disconnect().catch(() => {}))),
    };
  };

  await runAgentTask({ taskId, principal, request, sessionId, buildAgent, cache: taskCache });
};
