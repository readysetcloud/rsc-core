import {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  getBadgesForMetric,
  getCountersForActivity,
  counterKey,
  isEarned,
  computeLevel,
  toPublicBadge,
  META_BADGES,
  getBadge
} from './utils/badges.mjs';

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();
const TABLE_NAME = process.env.TABLE_NAME;

// Dedupe markers auto-expire; long enough to absorb any realistic retry/replay window.
const DEDUPE_TTL_DAYS = 90;

/**
 * The gamification rules engine. Consumes a single "Track Activity" event from
 * EventBridge, increments the relevant progress counters, evaluates the badges
 * that activity can affect, awards any newly-earned ones (idempotently), rolls
 * the points up into the user's level, and emits "Badge Awarded" / "Level Up"
 * events for the rest of the ecosystem to react to.
 */
export const handler = async (event) => {
  const detail = event.detail ?? event;
  const { id, userId, action, service } = detail;
  const amount = Number(detail.count ?? 1);
  const value = detail.value ?? service;

  if (!userId || !action) {
    console.warn('Skipping activity with missing userId/action', JSON.stringify(detail));
    return;
  }

  // Nothing in the catalog cares about this activity — cheap early exit.
  if (!getBadgesForMetric(action).length) return;

  // Idempotency: a repeated delivery of the same activity id must not double count.
  if (id && !(await claimActivity(userId, id))) return;

  const counters = await incrementCounters(userId, action, service, amount, value);
  const earnedIds = await getEarnedBadgeIds(userId);

  const newlyAwarded = [];

  for (const badge of getBadgesForMetric(action)) {
    if (earnedIds.has(badge.id)) continue;
    if (!isEarned(badge, counters, earnedIds)) continue;
    if (await awardBadge(userId, badge)) {
      earnedIds.add(badge.id);
      newlyAwarded.push(badge);
    }
  }

  // Meta badges ("collect them all") react to other badges being earned.
  if (newlyAwarded.length) {
    for (const meta of META_BADGES) {
      if (earnedIds.has(meta.id)) continue;
      if (!isEarned(meta, counters, earnedIds)) continue;
      if (await awardBadge(userId, meta)) {
        earnedIds.add(meta.id);
        newlyAwarded.push(meta);
      }
    }
  }

  if (!newlyAwarded.length) return;

  const { totalPoints, level, leveledUp } = await applyPoints(userId, newlyAwarded);
  await publishAwards(userId, newlyAwarded, totalPoints, level, leveledUp);
};

/** Writes a dedupe marker; returns false if this activity id was already processed. */
const claimActivity = async (userId, id) => {
  const ttl = Math.floor(Date.now() / 1000) + DEDUPE_TTL_DAYS * 24 * 60 * 60;
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({ pk: userId, sk: `evt#${id}`, ttl }),
      ConditionExpression: 'attribute_not_exists(pk)'
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
};

/**
 * Increments every counter this activity feeds and returns a map of
 * counterKey -> current value for the counters that were actually touched.
 */
const incrementCounters = async (userId, action, service, amount, value) => {
  const counters = getCountersForActivity(action, service);
  const result = {};

  await Promise.all(counters.map(async (counter) => {
    const sk = counterKey(counter);

    if (counter.unique) {
      if (!value) return; // nothing to add to the distinct set
      const res = await ddb.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ pk: userId, sk }),
        UpdateExpression: 'ADD #values :val SET #updated = :now',
        ExpressionAttributeNames: { '#values': 'values', '#updated': 'updatedDate' },
        ExpressionAttributeValues: marshall(
          { ':val': new Set([String(value)]), ':now': new Date().toISOString() }
        ),
        ReturnValues: 'UPDATED_NEW'
      }));
      const values = unmarshall(res.Attributes).values;
      result[sk] = values instanceof Set ? values.size : new Set(values).size;
    } else {
      const res = await ddb.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ pk: userId, sk }),
        UpdateExpression: 'ADD #count :amt SET #updated = :now',
        ExpressionAttributeNames: { '#count': 'count', '#updated': 'updatedDate' },
        ExpressionAttributeValues: marshall({ ':amt': amount, ':now': new Date().toISOString() }),
        ReturnValues: 'UPDATED_NEW'
      }));
      result[sk] = Number(unmarshall(res.Attributes).count);
    }
  }));

  return result;
};

/** Returns the set of badge ids the user has already earned. */
const getEarnedBadgeIds = async (userId) => {
  const ids = new Set();
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: marshall({ ':pk': userId, ':prefix': 'badge#' }),
      ProjectionExpression: 'sk',
      ExclusiveStartKey
    }));
    for (const item of res.Items ?? []) {
      ids.add(unmarshall(item).sk.replace('badge#', ''));
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return ids;
};

/** Idempotently records an earned badge. Returns false if it was already earned. */
const awardBadge = async (userId, badge) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        pk: userId,
        sk: `badge#${badge.id}`,
        badgeId: badge.id,
        points: badge.points,
        earnedDate: new Date().toISOString(),
        ...(badge.service && { service: badge.service })
      }),
      ConditionExpression: 'attribute_not_exists(pk)'
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
};

/** Adds the awarded points to the user's summary and recomputes their level. */
const applyPoints = async (userId, badges) => {
  const added = badges.reduce((sum, b) => sum + (b.points ?? 0), 0);

  const res = await ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: userId, sk: 'gamification' }),
    UpdateExpression: 'ADD totalPoints :pts, badgeCount :cnt SET updatedDate = :now',
    ExpressionAttributeValues: marshall({
      ':pts': added,
      ':cnt': badges.length,
      ':now': new Date().toISOString()
    }),
    ReturnValues: 'UPDATED_NEW'
  }));

  const totalPoints = Number(unmarshall(res.Attributes).totalPoints);
  const newLevel = computeLevel(totalPoints);
  const oldLevel = computeLevel(totalPoints - added);
  const leveledUp = newLevel.level !== oldLevel.level;

  await ddb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: userId, sk: 'gamification' }),
    UpdateExpression: 'SET #level = :level, levelName = :name',
    ExpressionAttributeNames: { '#level': 'level' },
    ExpressionAttributeValues: marshall({ ':level': newLevel.level, ':name': newLevel.name })
  }));

  return { totalPoints, level: newLevel, leveledUp };
};

/** Emits "Badge Awarded" (one per badge) and an optional "Level Up" event. */
const publishAwards = async (userId, badges, totalPoints, level, leveledUp) => {
  const entries = badges.map((badge) => ({
    Source: 'rsc-core',
    DetailType: 'Badge Awarded',
    Detail: JSON.stringify({
      userId,
      badge: toPublicBadge(getBadge(badge.id)),
      totalPoints,
      level: level.level,
      levelName: level.name,
      earnedDate: new Date().toISOString()
    })
  }));

  if (leveledUp) {
    entries.push({
      Source: 'rsc-core',
      DetailType: 'Level Up',
      Detail: JSON.stringify({ userId, level: level.level, levelName: level.name, totalPoints })
    });
  }

  // PutEvents accepts at most 10 entries per call.
  for (let i = 0; i < entries.length; i += 10) {
    await eventBridge.send(new PutEventsCommand({ Entries: entries.slice(i, i + 10) }));
  }
};
