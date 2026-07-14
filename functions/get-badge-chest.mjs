import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BADGES,
  getBadge,
  toPublicBadge,
  computeLevel,
  getNextLevel
} from './utils/badges.mjs';

const ddb = new DynamoDBClient();
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Returns the signed-in user's badge chest: earned badges (joined to the
 * catalog), their point total and level, and progress toward the badges they
 * haven't unlocked yet. This is the single read the shared BadgeChest UI hits.
 */
export const handler = async (event) => {
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return response(401, { message: 'Unauthorized' });
  }

  const items = await queryUser(userId);

  let summary;
  const earned = [];
  const counters = {};
  for (const item of items) {
    if (item.sk === 'gamification') summary = item;
    else if (item.sk.startsWith('badge#')) earned.push(item);
    else if (item.sk.startsWith('progress#')) counters[item.sk] = Number(item.count ?? 0);
    else if (item.sk.startsWith('unique#')) {
      counters[item.sk] = item.values instanceof Set ? item.values.size : 0;
    }
  }

  const earnedIds = new Set(earned.map((e) => e.badgeId));
  const totalPoints = Number(summary?.totalPoints ?? 0);
  const level = computeLevel(totalPoints);
  const nextLevel = getNextLevel(totalPoints);

  const badges = earned
    .map((e) => {
      const def = getBadge(e.badgeId);
      return {
        ...(def ? toPublicBadge(def) : { id: e.badgeId, points: e.points }),
        earnedDate: e.earnedDate
      };
    })
    .sort((a, b) => (a.earnedDate < b.earnedDate ? 1 : -1));

  const inProgress = BADGES
    .filter((b) => !earnedIds.has(b.id))
    .map((b) => ({
      ...toPublicBadge(b),
      current: currentProgress(b, counters, earnedIds),
      threshold: threshold(b)
    }))
    .filter((b) => b.threshold > 0);

  return response(200, {
    points: totalPoints,
    level: level.level,
    levelName: level.name,
    levelMinPoints: level.minPoints,
    nextLevel: nextLevel && {
      level: nextLevel.level,
      name: nextLevel.name,
      minPoints: nextLevel.minPoints,
      pointsToGo: nextLevel.pointsToGo
    },
    badgeCount: badges.length,
    badges,
    inProgress
  });
};

const threshold = (badge) => {
  const c = badge.criteria;
  if (c.type === 'meta') return c.threshold ?? c.badges.length;
  return c.threshold ?? 1;
};

const currentProgress = (badge, counters, earnedIds) => {
  const c = badge.criteria;
  switch (c.type) {
    case 'count': {
      const key = c.service ? `progress#${c.service}#${c.metric}` : `progress#${c.metric}`;
      return Math.min(counters[key] ?? 0, c.threshold);
    }
    case 'unique':
      return Math.min(counters[`unique#${c.metric}`] ?? 0, c.threshold);
    case 'meta':
      return c.badges.filter((id) => earnedIds.has(id)).length;
    default:
      return 0;
  }
};

const queryUser = async (userId) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({ ':pk': userId }),
      ExclusiveStartKey
    }));
    for (const item of res.Items ?? []) items.push(unmarshall(item));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
