import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Configure the client for signing before import: a fixed API URL (skips SSM)
// and static credentials so SigV4 signing is deterministic.
process.env.LINKS_API_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/Prod';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = 'secretexamplekey';
delete process.env.AWS_SESSION_TOKEN;

const {
  createShortLink,
  getShortLink,
  updateShortLink,
  deleteShortLink,
  getLinkAnalytics,
  getCampaignLinkAnalytics,
  LinksApiError,
} = await import('./index.js');

let fetchMock: ReturnType<typeof vi.fn>;

const jsonResponse = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), init: init as RequestInit & { headers: Record<string, string> } };
};

describe('createShortLink', () => {
  it('POSTs a SigV4-signed request to /links with the JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { code: 'aB3xY9', short_url: 'https://rdyset.click/aB3xY9', expires_at: '2027-01-01T00:00:00.000Z' })
    );

    const result = await createShortLink({ url: 'https://example.com', src: 'newsletter', campaignId: 'launch' });

    expect(result.code).toBe('aB3xY9');
    const { url, init } = lastCall();
    expect(init.method).toBe('POST');
    expect(url).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/Prod/links');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(init.headers['x-amz-date']).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com',
      src: 'newsletter',
      campaignId: 'launch',
    });
  });
});

describe('getShortLink', () => {
  it('GETs /links/{code} and returns the metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 'aB3xY9', url: 'https://example.com' }));

    const link = await getShortLink('aB3xY9');

    expect(link.url).toBe('https://example.com');
    const { url, init } = lastCall();
    expect(init.method).toBe('GET');
    expect(url).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/Prod/links/aB3xY9');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });
});

describe('updateShortLink', () => {
  it('PUTs the new destination', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 'aB3xY9', url: 'https://new.example.com' }));

    await updateShortLink('aB3xY9', { url: 'https://new.example.com' });

    const { url, init } = lastCall();
    expect(init.method).toBe('PUT');
    expect(url).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/Prod/links/aB3xY9');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://new.example.com' });
  });
});

describe('deleteShortLink', () => {
  it('DELETEs and tolerates an empty 204 body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined));

    await expect(deleteShortLink('aB3xY9')).resolves.toBeUndefined();

    const { init } = lastCall();
    expect(init.method).toBe('DELETE');
  });
});

describe('analytics', () => {
  it('reads per-code analytics', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 'aB3xY9', total_clicks: 5, by_day: {}, by_src: {} }));

    const analytics = await getLinkAnalytics('aB3xY9');

    expect(analytics.total_clicks).toBe(5);
    expect(lastCall().url).toBe('https://abc123.execute-api.us-east-1.amazonaws.com/Prod/links/aB3xY9/analytics');
  });

  it('reads per-campaign analytics with an encoded campaign id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { campaign_id: 'a/b', total_links: 0, total_clicks: 0, links: [] }));

    await getCampaignLinkAnalytics('a/b');

    expect(lastCall().url).toBe(
      'https://abc123.execute-api.us-east-1.amazonaws.com/Prod/campaigns/a%2Fb/links/analytics'
    );
  });
});

describe('error handling', () => {
  it('throws LinksApiError with the API message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: 'url is required' }));

    await expect(createShortLink({ url: '' })).rejects.toMatchObject({
      name: 'LinksApiError',
      status: 400,
      message: 'url is required',
    });
    expect(LinksApiError).toBeTypeOf('function');
  });
});
