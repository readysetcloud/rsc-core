import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireTableName } from '../aws/ddb.js';

// Conversation turns written to the single DynamoDB table. These rows are
// what the DynamoDB-stream vectorizer consumes to build semantic memory —
// keeping the write path (recordTurn) fast and the embedding cost off the
// request path, exactly as content-tracking does with its Content entity.
//
//   pk = MEMORY#{userId}
//   sk = TURN#{sessionId}#{ts}#{role}
//   entity = "Turn"   (the stream filter keys on this)

/** DynamoDB `entity` discriminator for a conversation-turn row (the stream vectorizer filters on it). */
export const TURN_ENTITY = 'Turn';

// Mirror the Python agent's 30-day AgentCore short-term memory window.
const TURN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A single conversation-turn row as written to the table. */
export interface TurnRow {
  pk: string;
  sk: string;
  entity: typeof TURN_ENTITY;
  userId: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  expiresAt: number;
}

/** Builds the `{ pk, sk }` primary key for a turn row (tenant-scoped by userId). */
export function turnKey(userId: string, sessionId: string, ts: number, role: string) {
  return {
    pk: `MEMORY#${userId}`,
    sk: `TURN#${sessionId}#${ts}#${role}`,
  };
}

function buildTurnRow(
  userId: string,
  sessionId: string,
  role: 'user' | 'assistant',
  text: string,
  ts: number,
): TurnRow {
  return {
    ...turnKey(userId, sessionId, ts, role),
    entity: TURN_ENTITY,
    userId,
    sessionId,
    turnId: `${ts}-${role}`,
    role,
    text,
    ts,
    expiresAt: Math.floor(ts / 1000) + TURN_TTL_SECONDS,
  };
}

/**
 * Persists a user request and the assistant response as two turn rows.
 * Skips empty text. Called by the host after a turn completes; the stream
 * consumer handles embedding into the vector index asynchronously.
 */
export async function recordTurn({
  userId,
  sessionId,
  request,
  response,
  now = Date.now(),
}: {
  userId: string;
  sessionId: string;
  request: string;
  response: string;
  now?: number;
}): Promise<void> {
  if (!userId || !sessionId) return;
  const TableName = requireTableName();

  const rows: TurnRow[] = [];
  if (request?.trim()) rows.push(buildTurnRow(userId, sessionId, 'user', request, now));
  // +1ms so the assistant row sorts after the user row within a turn.
  if (response?.trim()) rows.push(buildTurnRow(userId, sessionId, 'assistant', response, now + 1));

  await Promise.all(
    rows.map((Item) => ddb.send(new PutCommand({ TableName, Item }))),
  );
}
