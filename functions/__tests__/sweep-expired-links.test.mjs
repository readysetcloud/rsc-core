import { describe, test, expect, beforeEach, vi } from 'vitest';
import { marshall } from '@aws-sdk/util-dynamodb';

const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
const { CloudFrontKeyValueStoreClient } = await import('@aws-sdk/client-cloudfront-keyvaluestore');

process.env.TABLE_NAME = 'test-links-table';
process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/abc';

const { handler } = await import('../sweep-expired-links.mjs');

let mockDdbSend;
let mockKvsSend;
const cmd = (call) => call[0].constructor.name;

beforeEach(() => {
  mockDdbSend = vi.fn();
  mockKvsSend = vi.fn().mockResolvedValue({ ETag: 'etag-1' });
  DynamoDBClient.prototype.send = mockDdbSend;
  CloudFrontKeyValueStoreClient.prototype.send = mockKvsSend;
});

describe('sweep-expired-links', () => {
  test('deletes expired codes from KVS and DynamoDB', async () => {
    // GSI1 query -> one expired code, then deletePartition Query -> empty
    mockDdbSend
      .mockResolvedValueOnce({ Items: [marshall({ code: 'aB3xY9' })] }) // GSI1 expiry query
      .mockResolvedValueOnce({ Items: [] }); // deletePartition query

    const result = await handler();

    expect(result.deleted).toBe(1);
    expect(mockKvsSend.mock.calls.map(cmd)).toContain('DeleteKeyCommand');
  });

  test('counts codes whose KVS key is already gone', async () => {
    const notFound = new Error('missing');
    notFound.name = 'ResourceNotFoundException';
    mockKvsSend
      .mockResolvedValueOnce({ ETag: 'etag-1' }) // initial Describe
      .mockRejectedValueOnce(notFound); // DeleteKey -> not found
    mockDdbSend
      .mockResolvedValueOnce({ Items: [marshall({ code: 'aB3xY9' })] })
      .mockResolvedValueOnce({ Items: [] }); // deletePartition still runs

    const result = await handler();
    expect(result.kvsMissing).toBe(1);
    expect(result.deleted).toBe(0);
  });

  test('no expired codes is a no-op', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await handler();
    expect(result).toEqual({ deleted: 0, kvsMissing: 0, failed: 0 });
  });
});
