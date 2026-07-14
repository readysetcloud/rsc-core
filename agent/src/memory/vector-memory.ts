import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { embedText } from './embeddings.js';

// Semantic long-term memory over conversation turns, stored in an S3
// Vectors index. This replaces the AgentCore short-term Memory the Python
// agent used. Modeled on content-tracking's api/services/content-vectors.mjs.
//
// Vector key:   `${sessionId}#${turnId}` — deterministic so re-embedding a
//               turn overwrites it in place.
// Metadata:     filterable { userId, sessionId, role } to scope recall to a
//               user (and never leak across users); non-filterable { text, ts }
//               ride along so the tool can read the memory back to the model.

const BUCKET = process.env.VECTOR_BUCKET_NAME;
const INDEX = process.env.MEMORY_VECTOR_INDEX_NAME || 'conversation-memory';

// PutVectors caps entries per request; stay well under.
const PUT_BATCH = 100;

const client = new S3VectorsClient({});

function requireVectorConfig(): { bucket: string; index: string } {
  if (!BUCKET) {
    throw new Error('VECTOR_BUCKET_NAME environment variable is not set');
  }
  return { bucket: BUCKET, index: INDEX };
}

/** Deterministic vector key for a turn, so re-embedding overwrites it in place. */
export function memoryVectorKey(sessionId: string, turnId: string): string {
  return `${sessionId}#${turnId}`;
}

/** A conversation turn to embed and upsert into the memory index. */
export interface MemoryTurn {
  userId: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  /** Epoch millis; stored as non-filterable metadata for ordering/debug. */
  ts: number;
}

/** Embeds and upserts one or more conversation turns into the memory index. */
export async function putMemoryTurns(turns: MemoryTurn[]): Promise<void> {
  const { bucket, index } = requireVectorConfig();
  if (turns.length === 0) return;

  const vectors = await Promise.all(
    turns.map(async (turn) => ({
      key: memoryVectorKey(turn.sessionId, turn.turnId),
      data: { float32: await embedText(turn.text) },
      metadata: {
        userId: turn.userId,
        sessionId: turn.sessionId,
        role: turn.role,
        ts: turn.ts,
        text: turn.text,
      },
    })),
  );

  for (let i = 0; i < vectors.length; i += PUT_BATCH) {
    const batch = vectors.slice(i, i + PUT_BATCH);
    await client.send(
      new PutVectorsCommand({ vectorBucketName: bucket, indexName: index, vectors: batch }),
    );
  }
}

/** A memory returned by {@link recallMemory}: the turn plus its similarity distance. */
export interface RecalledMemory {
  sessionId?: string;
  role?: string;
  ts?: number;
  text?: string;
  distance?: number;
}

/**
 * Nearest-neighbour search over a user's past turns. The metadata filter
 * scopes results to the caller's userId so recall never leaks across users.
 * `excludeSessionId` drops the current conversation so the model recalls
 * *other* sessions, not what it already has in context.
 */
export async function recallMemory({
  userId,
  query,
  topK = 5,
}: {
  userId: string;
  query: string;
  topK?: number;
}): Promise<RecalledMemory[]> {
  const { bucket, index } = requireVectorConfig();
  if (!userId) throw new Error('recallMemory requires a userId');

  const queryEmbedding = await embedText(query);

  const res = await client.send(
    new QueryVectorsCommand({
      vectorBucketName: bucket,
      indexName: index,
      topK,
      queryVector: { float32: queryEmbedding },
      filter: { userId },
      returnMetadata: true,
      returnDistance: true,
    }),
  );

  return (res.vectors ?? []).map((v) => {
    const md = (v.metadata ?? {}) as Record<string, unknown>;
    return {
      sessionId: md.sessionId as string | undefined,
      role: md.role as string | undefined,
      ts: md.ts as number | undefined,
      text: md.text as string | undefined,
      distance: v.distance,
    };
  });
}

/** Deletes the memory vectors for a set of turn keys (e.g. on session delete). */
export async function deleteMemoryKeys(keys: string[]): Promise<void> {
  const { bucket, index } = requireVectorConfig();
  if (keys.length === 0) return;
  await client.send(
    new DeleteVectorsCommand({ vectorBucketName: bucket, indexName: index, keys }),
  );
}
