import { httpRequest } from '@strands-agents/sdk/vended-tools/http-request';
import { notebook } from '@strands-agents/sdk/vended-tools/notebook';
import type { ToolRegistry } from './registry.js';

// First-party built-in tools that ship WITH this package, ready for any host to
// offer or any caller to attach. The tool registry itself still lives in the
// host (see registry.ts) — apps own their menu of tools — but a generic
// capability like "make an HTTP request" is worth carrying here so every
// consumer gets it without re-authoring the same wrapper. The other side of the
// seam is unchanged: a host spreads {@link builtinTools} into its own registry
// and a session opts in by NAME.
//
// These wrap the Strands SDK's own vended tools (`@strands-agents/sdk/vended-tools`)
// so we get maintained, schema-validated implementations rather than home-grown
// ones. We deliberately expose only the tools that are safe and meaningful for a
// multi-tenant, ephemeral, server-side runtime:
//
//   - `http_request` — a generic HTTP client (GET/POST/…). This is the seam a
//     caller uses for WEB SEARCH: point it at a search API's endpoint (the
//     model supplies the query; the host supplies any key via the URL/headers)
//     and let the agent read the JSON back. Anything reachable over HTTP — a
//     search API, a public REST endpoint, a webhook — is in reach without a
//     bespoke first-party tool per integration.
//   - `notebook` — a scratchpad the model can write to and re-read within a run,
//     useful for multi-step reasoning. State lives in the invocation, not on the
//     host, so it is safe across sessions.
//
// The SDK also vends `bash` and `file_editor`. We intentionally DO NOT expose
// them: this package is meant to run inside a shared, hosted runtime (AgentCore,
// Lambda), where shell execution is remote code execution and filesystem access
// reaches the host's own disk. A host that genuinely wants them can still import
// them from the SDK and register them itself — that stays an explicit, auditable
// choice rather than a default this package hands out.
//
// NOTE ON `http_request` REACH: because the model chooses the URL, this tool is
// an outbound-request (SSRF) surface. In rsc-core the AgentCore runtime runs
// with no ambient outbound credentials and the network egress it's given is the
// boundary; a host with tighter needs should front the call with an allowlist or
// prefer a scoped MCP web-search gateway (see the README's MCP section) over the
// raw client.

/**
 * The vended `http_request` tool: a generic HTTP client the agent can use to
 * call external APIs — including a web-search API — reading the response body
 * back into the conversation. Re-exported so callers can attach it directly to
 * a `runAgent`/`createAssistant` `tools` list without going through a registry.
 */
export { httpRequest };

/**
 * The vended `notebook` tool: an in-invocation scratchpad the model can write to
 * and re-read across steps of a single run. Re-exported for direct attachment.
 */
export { notebook };

/**
 * The built-in tools this package ships, as a {@link ToolRegistry} keyed by the
 * stable name a session selects. Spread it into a host's own registry to offer
 * them alongside host-owned tools:
 *
 * ```ts
 * const TOOL_REGISTRY: ToolRegistry = {
 *   ...builtinTools,          // http_request, notebook
 *   get_current_time: () => tool({ ... }),
 * };
 * ```
 *
 * Each entry is a {@link ToolFactory}. The vended tools are stateless singletons
 * that ignore per-session context, so the factory just returns the shared
 * instance — reusing it across sessions is how the SDK intends these to be used.
 */
export const builtinTools: ToolRegistry = {
  http_request: () => httpRequest,
  notebook: () => notebook,
};

/**
 * The names of the tools in {@link builtinTools}. Handy for a host that wants to
 * advertise the built-ins it offers, or validate a session's selection against
 * the shipped set.
 */
export const BUILTIN_TOOL_NAMES = Object.keys(builtinTools);
