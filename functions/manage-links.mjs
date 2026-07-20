import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
  BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import '@aws-sdk/signature-v4a';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
  DeleteKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import {
  Router,
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from '@aws-lambda-powertools/event-handler/http';
import crypto from 'crypto';

const ddb = new DynamoDBClient();
const kvs = new CloudFrontKeyValueStoreClient();
const app = new Router();

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;
const MAX_COLLISION_RETRIES = 5;
const DEFAULT_EXPIRES_IN_DAYS = 730;
const MAX_EXPIRES_IN_DAYS = 1825;
const MAX_CAMPAIGN_ID_LENGTH = 128;

// ---------------------------------------------------------------------------
// Routes — one Lambda, Powertools routing. All routes are IAM-authorized at
// the API (service-to-service); the public redirect lives at the CloudFront
// edge, not here.
// ---------------------------------------------------------------------------
app.post('/links', mintLink);
app.get('/links/:code', getLink);
app.put('/links/:code', updateLink);
app.delete('/links/:code', deleteLink);
app.get('/links/:code/analytics', getLinkAnalytics);
app.get('/campaigns/:campaignId/links/analytics', getCampaignLinksAnalytics);

export const handler = async (event, context) => app.resolve(event, context);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function mintLink(reqCtx) {
  const body = await readJsonBody(reqCtx);
  const { url, src, expiresInDays, campaignId } = body;

  validateUrl(url);
  if (src !== undefined && typeof src !== 'string') {
    throw new BadRequestError('src must be a string when provided');
  }
  if (campaignId !== undefined) {
    if (typeof campaignId !== 'string') throw new BadRequestError('campaignId must be a string when provided');
    if (campaignId.trim().length === 0) throw new BadRequestError('campaignId cannot be empty when provided');
    if (campaignId.length > MAX_CAMPAIGN_ID_LENGTH) throw new BadRequestError(`campaignId exceeds ${MAX_CAMPAIGN_ID_LENGTH} chars`);
  }
  if (expiresInDays !== undefined &&
    (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRES_IN_DAYS)) {
    throw new BadRequestError(`expiresInDays must be an integer between 1 and ${MAX_EXPIRES_IN_DAYS}`);
  }

  const ttlDays = expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86400 * 1000).toISOString();

  const code = await allocateUniqueCode(now.toISOString(), expiresAt, url, src, campaignId);
  if (!code) {
    throw new ServiceUnavailableError('Could not allocate a unique code');
  }

  const kvsValue = { u: url };
  if (src) kvsValue.src = src;
  await writeKvsEntry(code, kvsValue);

  return created({
    code,
    short_url: `${process.env.SHORT_LINK_BASE}/${code}`,
    expires_at: expiresAt,
  });
}

async function getLink(reqCtx) {
  const code = validateCode(reqCtx.params.code);

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: `LINK#${code}`, sk: 'METADATA' }),
  }));

  if (!result.Item) {
    throw new NotFoundError(`Code ${code} not found`);
  }

  return formatLink(unmarshall(result.Item));
}

async function updateLink(reqCtx) {
  const code = validateCode(reqCtx.params.code);
  const body = await readJsonBody(reqCtx);
  const { url, src } = body;

  validateUrl(url);
  if (src !== undefined && src !== null && typeof src !== 'string') {
    throw new BadRequestError('src must be a string when provided');
  }

  const updatedAt = new Date().toISOString();
  let updated;
  try {
    const result = await ddb.send(new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ pk: `LINK#${code}`, sk: 'METADATA' }),
      UpdateExpression: 'SET #url = :url, src = :src, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#url': 'url' },
      ExpressionAttributeValues: marshall({
        ':url': url,
        ':src': src ?? null,
        ':updatedAt': updatedAt,
      }),
      ReturnValues: 'ALL_NEW',
    }));
    updated = unmarshall(result.Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new NotFoundError(`Code ${code} not found`);
    }
    throw err;
  }

  const kvsValue = { u: url };
  if (src) kvsValue.src = src;
  await writeKvsEntry(code, kvsValue);

  return formatLink(updated);
}

async function deleteLink(reqCtx) {
  const code = validateCode(reqCtx.params.code);

  await deleteKvsKey(code);
  await deletePartition(`LINK#${code}`);

  return noContent();
}

async function getLinkAnalytics(reqCtx) {
  const code = validateCode(reqCtx.params.code);

  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({ pk: `LINK#${code}`, sk: 'AGGREGATE' }),
  }));

  if (!result.Item) {
    return emptyAnalytics(code);
  }

  return formatAnalytics(code, unmarshall(result.Item));
}

async function getCampaignLinksAnalytics(reqCtx) {
  const campaignId = reqCtx.params.campaignId;
  if (!campaignId || typeof campaignId !== 'string' || campaignId.trim().length === 0) {
    throw new BadRequestError('campaignId is required');
  }
  if (campaignId.length > MAX_CAMPAIGN_ID_LENGTH) {
    throw new BadRequestError(`campaignId exceeds ${MAX_CAMPAIGN_ID_LENGTH} chars`);
  }

  const links = await queryCampaignLinks(campaignId);
  const analyticsByCode = await batchGetAnalytics(links.map((link) => link.code));

  return {
    campaign_id: campaignId,
    total_links: links.length,
    total_clicks: links.reduce((sum, link) => sum + (analyticsByCode.get(link.code)?.total_clicks ?? 0), 0),
    links: links.map((link) => ({
      ...formatLink(link),
      analytics: analyticsByCode.get(link.code) ?? emptyAnalytics(link.code),
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation + response helpers
// ---------------------------------------------------------------------------
function validateUrl(url) {
  if (!url || typeof url !== 'string') throw new BadRequestError('url is required');
  if (!/^https?:\/\//i.test(url)) throw new BadRequestError('url must be http or https');
  if (url.length > 2048) throw new BadRequestError('url exceeds 2048 chars');
}

function validateCode(code) {
  if (!code || !CODE_PATTERN.test(code)) {
    throw new BadRequestError('code must be 6 alphanumeric characters');
  }
  return code;
}

async function readJsonBody(reqCtx) {
  const raw = await reqCtx.req.text();
  if (!raw) throw new BadRequestError('Missing request body');
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError('Invalid JSON body');
  }
}

const jsonHeaders = { 'content-type': 'application/json' };
const created = (body) => new Response(JSON.stringify(body), { status: 201, headers: jsonHeaders });
const noContent = () => new Response(null, { status: 204 });

function formatLink(row) {
  return {
    code: row.code,
    short_url: `${process.env.SHORT_LINK_BASE}/${row.code}`,
    url: row.url,
    src: row.src ?? null,
    campaign_id: row.campaignId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    expires_at: row.expiresAt,
  };
}

function formatAnalytics(code, row) {
  return {
    code,
    total_clicks: row.totalClicks ?? 0,
    by_day: row.byDay ?? {},
    by_src: row.bySrc ?? {},
    first_click_at: row.firstClickAt ?? null,
    last_click_at: row.lastClickAt ?? null,
  };
}

const emptyAnalytics = (code) => formatAnalytics(code, {});

// ---------------------------------------------------------------------------
// DynamoDB + CloudFront KVS
// ---------------------------------------------------------------------------
async function allocateUniqueCode(createdAt, expiresAt, url, src, campaignId) {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const code = generateCode();
    const item = {
      pk: `LINK#${code}`,
      sk: 'METADATA',
      GSI1PK: 'LINK_EXPIRY',
      GSI1SK: expiresAt,
      entity: 'ShortLink',
      code,
      url,
      src: src || null,
      campaignId: campaignId ?? null,
      createdAt,
      expiresAt,
      updatedAt: createdAt,
    };

    if (campaignId) {
      item.GSI2PK = `LINK_CAMPAIGN#${campaignId}`;
      item.GSI2SK = `LINK#${createdAt}#${code}`;
    }

    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return code;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
  }
  return null;
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function queryCampaignLinks(campaignId) {
  const links = [];
  let exclusiveStartKey;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :campaign',
      ExpressionAttributeValues: marshall({
        ':campaign': `LINK_CAMPAIGN#${campaignId}`,
      }),
      ExclusiveStartKey: exclusiveStartKey,
    }));

    links.push(...(result.Items || []).map((item) => unmarshall(item)));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return links;
}

async function batchGetAnalytics(codes) {
  const analyticsByCode = new Map();

  for (let i = 0; i < codes.length; i += 100) {
    const keys = codes.slice(i, i + 100).map((code) => marshall({
      pk: `LINK#${code}`,
      sk: 'AGGREGATE',
    }));

    if (keys.length === 0) continue;
    let requestItems = {
      [process.env.TABLE_NAME]: { Keys: keys },
    };

    do {
      const result = await ddb.send(new BatchGetItemCommand({ RequestItems: requestItems }));
      for (const item of result.Responses?.[process.env.TABLE_NAME] || []) {
        const row = unmarshall(item);
        analyticsByCode.set(row.code, formatAnalytics(row.code, row));
      }
      requestItems = result.UnprocessedKeys && Object.keys(result.UnprocessedKeys).length > 0
        ? result.UnprocessedKeys
        : null;
    } while (requestItems);
  }

  return analyticsByCode;
}

async function deletePartition(pk) {
  let lastEvaluatedKey;
  do {
    const result = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'pk' },
      ExpressionAttributeValues: marshall({ ':pk': pk }),
      ProjectionExpression: '#pk, sk',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    const items = result.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map((it) => {
        const row = unmarshall(it);
        return { DeleteRequest: { Key: marshall({ pk: row.pk, sk: row.sk }) } };
      });
      if (batch.length === 0) continue;
      await ddb.send(new BatchWriteItemCommand({
        RequestItems: { [process.env.TABLE_NAME]: batch },
      }));
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

async function writeKvsEntry(code, value) {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  await kvs.send(new PutKeyCommand({
    KvsARN: process.env.KVS_ARN,
    Key: code,
    Value: JSON.stringify(value),
    IfMatch: describe.ETag,
  }));
}

async function deleteKvsKey(code) {
  const describe = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: process.env.KVS_ARN }));
  try {
    await kvs.send(new DeleteKeyCommand({
      KvsARN: process.env.KVS_ARN,
      Key: code,
      IfMatch: describe.ETag,
    }));
  } catch (err) {
    if (err.name === 'ResourceNotFoundException' || err.$metadata?.httpStatusCode === 404) {
      return;
    }
    throw err;
  }
}
