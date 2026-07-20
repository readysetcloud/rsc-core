import { describe, test, expect, beforeEach, vi } from 'vitest';
import zlib from 'zlib';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');

process.env.TABLE_NAME = 'test-links-table';

const { handler } = await import('../process-link-click.mjs');

const logsEvent = (messages) => {
  const payload = {
    logGroup: '/aws/cloudfront/function/rsc-link-redirect',
    logStream: 'stream',
    logEvents: messages.map((m, i) => ({
      id: String(i),
      timestamp: Date.parse('2026-07-20T12:00:00Z'),
      message: typeof m === 'string' ? m : JSON.stringify(m),
    })),
  };
  return { awslogs: { data: zlib.gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64') } };
};

let mockDdbSend;
beforeEach(() => {
  mockDdbSend = vi.fn().mockResolvedValue({});
  DynamoDBClient.prototype.send = mockDdbSend;
});

const cmd = (call) => call[0].constructor.name;

describe('process-link-click', () => {
  test('records a click event and increments the aggregate', async () => {
    const res = await handler(logsEvent([{ code: 'aB3xY9', u: 'https://example.com', src: 'nl' }]));
    expect(res.statusCode).toBe(200);

    const names = mockDdbSend.mock.calls.map(cmd);
    expect(names).toContain('PutItemCommand');   // click event
    expect(names).toContain('UpdateItemCommand'); // aggregate

    const put = mockDdbSend.mock.calls.find((c) => cmd(c) === 'PutItemCommand')[0];
    expect(put.input.Item.pk.S).toBe('LINK#aB3xY9');
    expect(put.input.Item.sk.S).toMatch(/^CLICK#/);
  });

  test('skips messages without a code', async () => {
    await handler(logsEvent([{ u: 'https://example.com' }, 'no json here']));
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  test('tolerates a malformed CloudWatch payload', async () => {
    const res = await handler({ awslogs: { data: 'not-base64-gzip' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).processed).toBe(0);
  });
});
