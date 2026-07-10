/*
 * Auth configuration — injected by the consuming app.
 *
 * Apps share ONE Cognito user pool (rsc-core exposes the pool id/client id
 * via SSM: /readysetcloud/auth/*) but each supplies its own app client.
 *
 * Accepts either a static config or an async loader (e.g. concurrency
 * bootcamp fetches /auth-config.json at runtime):
 *
 *   configureAuth({ region: 'us-east-1', clientId: '...' });
 *   configureAuth(async () => (await fetch('/auth-config.json')).json());
 */

export interface AuthConfig {
  region: string;
  clientId: string;
  /**
   * Optional parent-domain session bridge for SSO across sibling subdomains.
   *
   * Example: `.readysetcloud.io` lets `booked.readysetcloud.io`,
   * `newsletter.readysetcloud.io`, and `bootcamp.readysetcloud.io` bootstrap
   * the same `rsc:auth` session. Defaults to `.readysetcloud.io` when running
   * on a readysetcloud.io host; unrelated domains such as `oliviasgarden.org`
   * do not opt in unless they set this explicitly.
   */
  sharedCookieDomain?: string;
  /** Defaults to `rsc_auth`. */
  sharedCookieName?: string;
  /** Defaults to 30 days. */
  sharedCookieMaxAgeSeconds?: number;
}

type ConfigSource = AuthConfig | (() => Promise<AuthConfig | null>) | null;

let source: ConfigSource = null;
let cached: AuthConfig | null = null;
let pending: Promise<AuthConfig | null> | null = null;

export function configureAuth(config: ConfigSource): void {
  source = config;
  cached = null;
  pending = null;
}

export async function getConfig(): Promise<AuthConfig | null> {
  if (cached) return cached;
  if (!source) return null;
  if (typeof source !== 'function') {
    cached = source;
    return cached;
  }
  // dedupe concurrent loads
  pending ??= source().catch(() => null);
  const loaded = await pending;
  pending = null;
  if (loaded && typeof loaded.region === 'string' && typeof loaded.clientId === 'string') {
    cached = loaded;
  }
  return cached;
}

export function peekConfig(): AuthConfig | null {
  if (cached) return cached;
  if (source && typeof source !== 'function') return source;
  return null;
}
