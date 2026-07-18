import type { McpServerSpec } from './sessions.js';

// Resolves a session's declarative MCP specs into connection configs the Strands
// SDK consumes, folding the two identity mechanisms into outbound headers. Kept
// here (Strands-free, on the ./memory subpath) so the security-sensitive logic —
// which credential is forwarded to which host — is unit-tested, and the runtime
// stays a thin caller. The output is plain and JSON-serializable; the caller
// casts it to the SDK's `McpServerConfig`.

/** The spec minus the fields that resolve into headers. */
export type ResolvedMcpServerConfig = Omit<McpServerSpec, 'authHeader' | 'forwardConnectionToken'>;

/** Options for {@link resolveMcpServerConfigs}. */
export interface ResolveMcpOptions {
  /**
   * The connecting user's live bearer token (no `Bearer ` prefix). Forwarded as
   * `Authorization: Bearer <token>` to servers with `forwardConnectionToken`.
   */
  connectionToken?: string;
  /**
   * Hosts the connection token may be forwarded to. Forwarding a real user
   * credential to any other host is refused — this is the guard against leaking
   * the token to an unlisted (e.g. attacker-controlled) MCP endpoint.
   */
  allowedHosts?: string[];
}

function hostAllowed(url: string | undefined, allowedHosts: string[]): boolean {
  if (!url) return false;
  try {
    return allowedHosts.includes(new URL(url).host);
  } catch {
    return false;
  }
}

/**
 * Maps `specs` to connection configs, applying (in order):
 *
 * 1. **`authHeader`** (rsc-core #197) — an authority-minted token, applied
 *    verbatim AFTER the user-supplied `headers` so a session can't shadow it.
 * 2. **`forwardConnectionToken`** (rsc-core #199) — inject the connecting user's
 *    live bearer as `Authorization`, for a gateway whose authorizer validates the
 *    end user's token. Applied ONLY when a `connectionToken` is present AND the
 *    server's host is in `allowedHosts`; otherwise it is silently skipped (never
 *    forward a real user credential to an unlisted host).
 *
 * The `authHeader`/`forwardConnectionToken` fields themselves are stripped from
 * the returned config (they are not SDK connection fields).
 */
export function resolveMcpServerConfigs(
  specs: Record<string, McpServerSpec>,
  options: ResolveMcpOptions = {},
): Record<string, ResolvedMcpServerConfig> {
  const { connectionToken, allowedHosts = [] } = options;
  const configs: Record<string, ResolvedMcpServerConfig> = {};

  for (const [name, spec] of Object.entries(specs)) {
    const { authHeader, forwardConnectionToken, ...rest } = spec;

    if (authHeader?.name) {
      rest.headers = { ...rest.headers, [authHeader.name]: authHeader.value };
    }

    if (forwardConnectionToken && connectionToken && hostAllowed(rest.url, allowedHosts)) {
      rest.headers = { ...rest.headers, Authorization: `Bearer ${connectionToken}` };
    }

    configs[name] = rest;
  }

  return configs;
}
