import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

/**
 * Client for the Ready, Set, Cloud link-shortening service.
 *
 * The service lives in `rsc-core`; this package lets any RSC app's backend mint
 * and manage short links without hand-rolling SigV4-signed HTTP. Requests are
 * signed with the ambient AWS credentials (service `execute-api`), so the
 * calling Lambda's role must be granted `execute-api:Invoke` on the links API.
 *
 * The API base URL is taken from `process.env.LINKS_API_URL` when set, otherwise
 * resolved (and cached) from SSM at `/readysetcloud/links/api-base-url`.
 */

const SSM_PARAM = '/readysetcloud/links/api-base-url';

export interface ShortLink {
  code: string;
  short_url: string;
  url: string;
  src: string | null;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface MintedShortLink {
  code: string;
  short_url: string;
  expires_at: string;
}

export interface LinkAnalytics {
  code: string;
  total_clicks: number;
  by_day: Record<string, number>;
  by_src: Record<string, number>;
  first_click_at: string | null;
  last_click_at: string | null;
}

export interface CampaignLinkAnalytics {
  campaign_id: string;
  total_links: number;
  total_clicks: number;
  links: Array<ShortLink & { analytics: LinkAnalytics }>;
}

export interface CreateShortLinkInput {
  /** Destination URL. Must be http(s) and <= 2048 chars. */
  url: string;
  /** Optional source/campaign tag recorded on every click (e.g. "newsletter"). */
  src?: string;
  /** Optional campaign id to group links for aggregate analytics (<= 128 chars). */
  campaignId?: string;
  /** Days until the code expires and is swept (1..1825, default 730). */
  expiresInDays?: number;
}

export interface UpdateShortLinkInput {
  url: string;
  src?: string | null;
}

/** Thrown when the links API responds with a non-2xx status. */
export class LinksApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'LinksApiError';
    this.status = status;
    this.body = body;
  }
}

let cachedBaseUrl: string | undefined;
let signer: SignatureV4 | undefined;

async function resolveBaseUrl(): Promise<string> {
  if (process.env.LINKS_API_URL) return process.env.LINKS_API_URL;
  if (cachedBaseUrl) return cachedBaseUrl;
  // Loaded lazily so callers that set LINKS_API_URL never pull in the SSM client.
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const client = new SSMClient({});
  const result = await client.send(new GetParameterCommand({ Name: SSM_PARAM }));
  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(
      `Links API URL not found. Set LINKS_API_URL or the SSM parameter ${SSM_PARAM}.`
    );
  }
  cachedBaseUrl = value;
  return value;
}

function getSigner(region: string): SignatureV4 {
  if (!signer) {
    signer = new SignatureV4({
      service: 'execute-api',
      region,
      credentials: fromNodeProviderChain(),
      sha256: Sha256,
    });
  }
  return signer;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
  const base = (await resolveBaseUrl()).replace(/\/$/, '');
  const url = new URL(base + path);
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const payload = body === undefined ? undefined : JSON.stringify(body);

  const headers: Record<string, string> = { host: url.hostname };
  if (payload !== undefined) headers['content-type'] = 'application/json';

  const signed = await getSigner(region).sign(
    new HttpRequest({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: payload,
    })
  );

  const res = await fetch(url.toString(), {
    method,
    headers: signed.headers,
    body: payload,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && String((data as { message: unknown }).message)) ||
      `Links API request failed with status ${res.status}`;
    throw new LinksApiError(res.status, message, data);
  }
  return data as T;
}

/** Mint a new short link. Returns the code, full short URL, and expiry. */
export async function createShortLink(input: CreateShortLinkInput): Promise<MintedShortLink> {
  return (await request<MintedShortLink>('POST', '/links', input))!;
}

/** Fetch a short link's metadata by code. */
export async function getShortLink(code: string): Promise<ShortLink> {
  return (await request<ShortLink>('GET', `/links/${encodeURIComponent(code)}`))!;
}

/** Update a short link's destination (and optional source tag) by code. */
export async function updateShortLink(code: string, input: UpdateShortLinkInput): Promise<ShortLink> {
  return (await request<ShortLink>('PUT', `/links/${encodeURIComponent(code)}`, input))!;
}

/** Delete a short link (metadata, clicks, and the edge redirect entry). */
export async function deleteShortLink(code: string): Promise<void> {
  await request<void>('DELETE', `/links/${encodeURIComponent(code)}`);
}

/** Read per-code click analytics (totals, by-day, by-source). */
export async function getLinkAnalytics(code: string): Promise<LinkAnalytics> {
  return (await request<LinkAnalytics>('GET', `/links/${encodeURIComponent(code)}/analytics`))!;
}

/** Read aggregate analytics across every link in a campaign. */
export async function getCampaignLinkAnalytics(campaignId: string): Promise<CampaignLinkAnalytics> {
  return (await request<CampaignLinkAnalytics>(
    'GET',
    `/campaigns/${encodeURIComponent(campaignId)}/links/analytics`
  ))!;
}
