import { describe, test, expect, beforeEach, vi } from 'vitest';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { CloudFrontKeyValueStoreClient } = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-links-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';
process.env.SHORT_LINK_BASE = 'https://rdyset.click';

const { handler } = await import('../manage-links.mjs');

const context = { awsRequestId: 'test', functionName: 'ManageLinks' };

// Minimal API Gateway REST (v1) proxy event, matching Powertools' event detector.
const event = (method, path, { body, query } = {}) => ({
  resource: '/{proxy+}',
  httpMethod: method,
  path,
  headers: { 'content-type': 'application/json', host: 'links.example.com' },
  multiValueHeaders: null,
  requestContext: { httpMethod: method, path, stage: 'Prod' },
  pathParameters: { proxy: path.replace(/^\//, '') },
  stageVariables: null,
  queryStringParameters: query || null,
  multiValueQueryStringParameters: null,
  body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: false,
});

const invoke = async (...args) => {
  const res = await handler(event(...args), context);
  return { statusCode: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
};

let mockDdbSend;
let mockKvsSend;

beforeEach(() => {
  mockDdbSend = vi.fn();
  mockKvsSend = vi.fn().mockResolvedValue({ ETag: 'etag-1' });
  DynamoDBClient.prototype.send = mockDdbSend;
  CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
});

const cmd = (call) => call.constructor.name;

describe('POST /links (mint)', () => {
  test('400 when body missing', async () => {
    const res = await invoke('POST', '/links');
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Missing request body/);
  });

  test('400 when url missing', async () => {
    const res = await invoke('POST', '/links', { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/url/);
  });

  test('400 when url not http(s)', async () => {
    const res = await invoke('POST', '/links', { body: { url: 'ftp://x.com' } });
    expect(res.statusCode).toBe(400);
  });

  test('400 when expiresInDays out of range', async () => {
    const res = await invoke('POST', '/links', { body: { url: 'https://x.com', expiresInDays: 99999 } });
    expect(res.statusCode).toBe(400);
  });

  test('201 mints a code, writes DDB + KVS', async () => {
    mockDdbSend.mockResolvedValueOnce({}); // PutItem success
    const res = await invoke('POST', '/links', { body: { url: 'https://example.com', src: 'nl', campaignId: 'launch' } });

    expect(res.statusCode).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(res.body.short_url).toBe(`https://rdyset.click/${res.body.code}`);
    expect(res.body.expires_at).toBeTruthy();

    const put = mockDdbSend.mock.calls.find((c) => cmd(c[0]) === 'PutItemCommand')[0];
    expect(put.input.ConditionExpression).toMatch(/attribute_not_exists/);
    // KVS: Describe then PutKey
    expect(mockKvsSend.mock.calls.map((c) => cmd(c[0]))).toContain('PutKeyCommand');
  });

  test('503 when code cannot be allocated after retries', async () => {
    const err = new Error('exists');
    err.name = 'ConditionalCheckFailedException';
    mockDdbSend.mockRejectedValue(err);
    const res = await invoke('POST', '/links', { body: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(503);
  });
});

describe('GET /links/{code}', () => {
  test('400 on bad code', async () => {
    const res = await invoke('GET', '/links/short');
    expect(res.statusCode).toBe(400);
  });

  test('404 when not found', async () => {
    mockDdbSend.mockResolvedValueOnce({}); // GetItem no Item
    const res = await invoke('GET', '/links/aB3xY9');
    expect(res.statusCode).toBe(404);
  });

  test('200 returns metadata', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: marshall({
        code: 'aB3xY9', url: 'https://example.com', src: 'nl', campaignId: 'launch',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z',
      }),
    });
    const res = await invoke('GET', '/links/aB3xY9');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ code: 'aB3xY9', url: 'https://example.com', campaign_id: 'launch' });
    expect(res.body.short_url).toBe('https://rdyset.click/aB3xY9');
  });
});

describe('PUT /links/{code}', () => {
  test('404 when code does not exist', async () => {
    const err = new Error('nope');
    err.name = 'ConditionalCheckFailedException';
    mockDdbSend.mockRejectedValueOnce(err);
    const res = await invoke('PUT', '/links/aB3xY9', { body: { url: 'https://new.com' } });
    expect(res.statusCode).toBe(404);
  });

  test('200 updates destination + KVS', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Attributes: marshall({ code: 'aB3xY9', url: 'https://new.com', createdAt: 'c', updatedAt: 'u', expiresAt: 'e' }),
    });
    const res = await invoke('PUT', '/links/aB3xY9', { body: { url: 'https://new.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe('https://new.com');
    expect(mockKvsSend.mock.calls.map((c) => cmd(c[0]))).toContain('PutKeyCommand');
  });
});

describe('DELETE /links/{code}', () => {
  test('204 deletes KVS key + DDB partition', async () => {
    // deleteKvsKey: Describe + DeleteKey ; deletePartition: Query (empty)
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const res = await invoke('DELETE', '/links/aB3xY9');
    expect(res.statusCode).toBe(204);
    expect(mockKvsSend.mock.calls.map((c) => cmd(c[0]))).toContain('DeleteKeyCommand');
  });
});

describe('GET /links/{code}/analytics', () => {
  test('empty analytics when no aggregate', async () => {
    mockDdbSend.mockResolvedValueOnce({}); // GetItem AGGREGATE missing
    const res = await invoke('GET', '/links/aB3xY9/analytics');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ code: 'aB3xY9', total_clicks: 0, by_day: {}, by_src: {} });
  });

  test('returns aggregate', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: marshall({ code: 'aB3xY9', totalClicks: 3, byDay: { '2026-07-20': 3 }, bySrc: { web: 3 }, firstClickAt: 'f', lastClickAt: 'l' }),
    });
    const res = await invoke('GET', '/links/aB3xY9/analytics');
    expect(res.body.total_clicks).toBe(3);
    expect(res.body.by_src).toEqual({ web: 3 });
  });
});

describe('GET /campaigns/{campaignId}/links/analytics', () => {
  test('aggregates links + clicks for a campaign', async () => {
    // 1) Query GSI2 -> one link ; 2) BatchGet aggregates
    mockDdbSend.mockResolvedValueOnce({
      Items: [marshall({ code: 'aB3xY9', url: 'https://example.com', campaignId: 'launch', createdAt: 'c', updatedAt: 'u', expiresAt: 'e' })],
    });
    mockDdbSend.mockResolvedValueOnce({
      Responses: { 'test-links-table': [marshall({ code: 'aB3xY9', totalClicks: 7, byDay: {}, bySrc: {} })] },
    });
    const res = await invoke('GET', '/campaigns/launch/links/analytics');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ campaign_id: 'launch', total_links: 1, total_clicks: 7 });
    expect(res.body.links[0].analytics.total_clicks).toBe(7);
  });
});

describe('unknown route', () => {
  test('404', async () => {
    const res = await invoke('GET', '/nope');
    expect(res.statusCode).toBe(404);
  });
});
