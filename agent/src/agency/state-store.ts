import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireTableName } from '../aws/ddb.js';

// A small revision-checked document store for an agent's operational state:
// its agenda, its commitment book, anything else that must survive between
// runs and must never be clobbered by two runs writing at once. One item per
// (agent, name, scope):
//
//   pk = AGENT#{agentId}
//   sk = STATE#{name}            (no scope)
//   sk = STATE#{name}#{scope}    (scope: a tenure, a season, a project — a new
//                                 scope starts empty, so a replaced occupant
//                                 inherits nothing)
//   entity = "AgentState", revision, value, updatedAt, [expiresAt]
//
// `updateAgentState` is read-modify-write under a revision condition with a few
// retries, so concurrent reconciliations serialize instead of losing each
// other's writes. Reads are strongly consistent.

/** DynamoDB `entity` discriminator for a state row. */
export const AGENT_STATE_ENTITY = 'AgentState';

const DEFAULT_ATTEMPTS = 3;

export interface AgentStateKey {
  agentId: string;
  /** What the document is (`agenda`, `commitments`, ...). */
  name: string;
  /** Isolates the document to a tenure/season/project; omit for one document per agent. */
  scope?: string;
  /** Table to use; defaults to the `TABLE_NAME` env var. */
  tableName?: string;
}

export interface AgentStateRecord<T> {
  value: T;
  revision: number;
  updatedAt: number;
}

function stateKey(key: AgentStateKey) {
  const scope = key.scope === undefined || key.scope === '' ? '' : `#${key.scope}`;
  return { pk: `AGENT#${key.agentId}`, sk: `STATE#${key.name}${scope}` };
}

/** Loads an agent's state document, or null when it has none yet. */
export async function readAgentState<T>(key: AgentStateKey): Promise<AgentStateRecord<T> | null> {
  if (!key.agentId || !key.name) throw new Error('readAgentState requires agentId and name');
  const TableName = requireTableName(key.tableName);
  const res = await ddb.send(new GetCommand({ TableName, Key: stateKey(key), ConsistentRead: true }));
  if (!res.Item) return null;
  return {
    value: res.Item.value as T,
    revision: res.Item.revision as number,
    updatedAt: res.Item.updatedAt as number,
  };
}

export interface UpdateAgentStateOptions<T> extends AgentStateKey {
  /**
   * Computes the next document from the current one (null when none exists). Called again on a
   * revision conflict, so it must be pure. Return the same reference to write nothing.
   */
  update: (current: T | null) => T | Promise<T>;
  /** Compare-and-swap attempts before giving up (default 3). */
  attempts?: number;
  /** Row TTL (ms from now), for state that should expire with its scope. */
  ttlMs?: number;
  /** Override the timestamp (epoch millis); defaults to `Date.now()`. */
  now?: number;
}

/**
 * Reads, applies `update`, and writes back under the revision read, retrying on a concurrent
 * write. Returns the document now stored (the new one, or the current one when `update` returned
 * it unchanged). Throws after `attempts` conflicts in a row.
 */
export async function updateAgentState<T>(options: UpdateAgentStateOptions<T>): Promise<AgentStateRecord<T>> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const TableName = requireTableName(options.tableName);
  const Key = stateKey(options);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await readAgentState<T>(options);
    const next = await options.update(current?.value ?? null);
    if (current !== null && next === current.value) return current;
    const now = options.now ?? Date.now();
    const revision = (current?.revision ?? 0) + 1;
    try {
      await ddb.send(new PutCommand({
        TableName,
        Item: {
          ...Key,
          entity: AGENT_STATE_ENTITY,
          agentId: options.agentId,
          name: options.name,
          ...(options.scope ? { scope: options.scope } : {}),
          value: next,
          revision,
          updatedAt: now,
          ...(options.ttlMs !== undefined ? { expiresAt: Math.floor((now + options.ttlMs) / 1000) } : {}),
        },
        ConditionExpression: current === null ? 'attribute_not_exists(pk)' : 'revision = :revision',
        ...(current === null ? {} : { ExpressionAttributeValues: { ':revision': current.revision } }),
      }));
      return { value: next, revision, updatedAt: now };
    } catch (err) {
      if ((err as { name?: string })?.name !== 'ConditionalCheckFailedException') throw err;
      lastError = err;
    }
  }
  throw new Error(`updateAgentState: ${options.name} for ${options.agentId} changed ${attempts} times while updating`, {
    cause: lastError,
  });
}
