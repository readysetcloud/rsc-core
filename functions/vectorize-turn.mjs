import { unmarshall } from '@aws-sdk/util-dynamodb';
import { putMemoryTurns, deleteMemoryKeys, memoryVectorKey } from '@readysetcloud/agent/memory';

// DynamoDB-stream-driven semantic-memory vectorizer for the agent chat table.
// The event source mapping (template.yaml) is filtered to Turn rows, so this
// only sees conversation turns — never snapshots or manifests. This keeps
// embedding cost off the chat request path, exactly as the badge/tenant stream
// handlers keep their work off the write path.
//
//   INSERT / MODIFY -> embed the turn text and upsert its memory vector.
//   REMOVE          -> delete the turn's memory vector (e.g. on TTL expiry).
//
// The embedding + vector write live in @readysetcloud/agent (the Strands-free
// /memory subpath) so there is a single implementation shared with the recall
// path in the agent runtime. Records are processed independently; a thrown
// record bubbles up so the stream retries the batch and exhausted retries land
// in the configured DLQ.
export const handler = async (event) => {
  for (const record of event?.Records ?? []) {
    await handleRecord(record);
  }
};

const handleRecord = async (record) => {
  if (record.eventName === 'REMOVE') {
    const oldImage = record.dynamodb?.OldImage;
    if (!oldImage) return;
    const turn = unmarshall(oldImage);
    if (turn.entity !== 'Turn') return;
    await deleteMemoryKeys([memoryVectorKey(turn.sessionId, turn.turnId)]);
    console.log('Deleted memory vector', { sessionId: turn.sessionId, turnId: turn.turnId });
    return;
  }

  // INSERT or MODIFY.
  const newImage = record.dynamodb?.NewImage;
  if (!newImage) return;
  const turn = unmarshall(newImage);

  // Defense in depth: the stream filter already restricts to Turn rows.
  if (turn.entity !== 'Turn') {
    console.warn('Ignoring non-Turn stream record', { entity: turn.entity, sk: turn.sk });
    return;
  }

  await putMemoryTurns([
    {
      userId: turn.userId,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      role: turn.role,
      text: turn.text,
      ts: turn.ts
    }
  ]);
  console.log('Embedded turn into memory', { sessionId: turn.sessionId, turnId: turn.turnId });
};
