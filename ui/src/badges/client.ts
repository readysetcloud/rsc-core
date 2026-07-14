import type { ActivityInput, BadgeCatalog, BadgeChestData } from './types';

export interface BadgeClientOptions {
  /**
   * Base URL of the Badge Chest API. In apps this comes from the rsc-core SSM
   * parameter `/readysetcloud/badges/api-url`.
   */
  baseUrl: string;
  /**
   * Returns a valid Cognito id token for the signed-in user. Required for the
   * per-user endpoints (chest, record activity); pass `useAuth().getToken`.
   */
  getToken?: () => Promise<string | null | undefined> | string | null | undefined;
  /** Override the fetch implementation (tests, SSR). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface BadgeClient {
  /** The signed-in user's chest — earned badges, points, level, progress. */
  getChest(): Promise<BadgeChestData>;
  /** The public catalog of every earnable badge and the level ladder. */
  getCatalog(): Promise<BadgeCatalog>;
  /** Record an activity; the rules engine decides whether it earns a badge. */
  recordActivity(activity: ActivityInput): Promise<{ id: string }>;
}

/**
 * Creates a small client for the rsc-core Badge Chest API. Framework-agnostic
 * (just `fetch`), so it works in React apps, the vanilla course pages, and on
 * the server.
 */
export function createBadgeClient(options: BadgeClientOptions): BadgeClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  const authHeader = async (): Promise<Record<string, string>> => {
    const token = typeof options.getToken === 'function' ? await options.getToken() : options.getToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const request = async <T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> => {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (init?.auth !== false) Object.assign(headers, await authHeader());

    const res = await doFetch(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new Error(`Badge API ${path} failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  };

  return {
    getChest: () => request<BadgeChestData>('/badges/me'),
    getCatalog: () => request<BadgeCatalog>('/badges/catalog', { auth: false }),
    recordActivity: (activity) =>
      request<{ id: string }>('/badges/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activity)
      })
  };
}
