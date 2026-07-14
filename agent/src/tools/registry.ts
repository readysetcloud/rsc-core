import type { AgentConfig } from '@strands-agents/sdk';

// A named registry of tool factories. This is the seam that lets a generic host
// (e.g. the AgentCore runtime) offer a menu of first-party tools that a session
// selects by NAME in its config — so enabling/disabling a shipped tool per
// session is a data operation, while authoring a genuinely new tool is the only
// thing that needs a code change. It composes with external tools (MCP clients,
// sub-agents), which are passed alongside the resolved named tools.
//
// The registry lives in the HOST, not this package: apps register whatever tools
// they own. The package provides the type + resolver machinery and ships
// `recall_memory` as a built-in factory (see createRecallMemoryTool).

/**
 * A single item acceptable in a Strands `Agent`'s tool list — a `tool()`, an
 * `McpClient`, or a sub-`Agent`. Aliased from the SDK's own tool-list element
 * type so the registry never narrows what the agent can accept.
 */
export type AgentTool = NonNullable<AgentConfig['tools']>[number];

/** Context handed to a {@link ToolFactory} when a session selects its tool. */
export interface ToolContext {
  /** The conversation/session id the tool is being built for. */
  sessionId: string;
  /** Verified caller id; user-scoped tools (e.g. memory) close over it. */
  userId?: string;
}

/**
 * Builds a tool for a given session/user. Registered under a stable name in a
 * {@link ToolRegistry}; invoked once per session when that name is selected.
 */
export type ToolFactory = (context: ToolContext) => AgentTool;

/**
 * A `name → factory` map of the tools a host makes available for session
 * selection. Session config references entries by name; unknown names resolve
 * to nothing (see {@link resolveTools}).
 */
export type ToolRegistry = Record<string, ToolFactory>;

/**
 * Resolves the tool names a session selected into concrete tools using the
 * host's registry. Names not present in the registry are skipped rather than
 * throwing, so a session that references a tool removed from a later build (or
 * not shipped in this host) degrades gracefully instead of failing to start.
 *
 * @param names    Selected tool names from the session config (may be undefined).
 * @param registry The host's `name → factory` map.
 * @param context  Session/user context passed to each selected factory.
 * @returns The resolved tools, ready to spread into `createAssistant({ tools })`.
 */
export function resolveTools(
  names: string[] | undefined,
  registry: ToolRegistry,
  context: ToolContext,
): AgentTool[] {
  if (!names?.length) return [];

  const resolved: AgentTool[] = [];
  for (const name of names) {
    const factory = registry[name];
    if (factory) resolved.push(factory(context));
  }
  return resolved;
}
