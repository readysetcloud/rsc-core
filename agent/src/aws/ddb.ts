import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// One shared Document client per execution environment. The Document
// client wraps the low-level client and marshalls/unmarshalls plain JS
// objects, matching the convention in readysetcloud/content-tracking
// (api/services/ddb.mjs). Connection reuse is implicit on Node 22+.
const baseClient = new DynamoDBClient({});

/** Shared DynamoDB Document client (marshalls/unmarshalls plain JS objects). */
export const ddb = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/** The single-table name, read from the `TABLE_NAME` env var (may be undefined). */
export const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Resolves the table to operate on. Pass an explicit `tableName` to point the
 * package at a specific table (library mode — a caller running the agent in its
 * own stack against its own table); omit it to default to the `TABLE_NAME` env
 * var (hosted mode). Throws a clear error only when neither is available.
 */
export function requireTableName(tableName?: string): string {
  const name = tableName ?? TABLE_NAME;
  if (!name) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return name;
}
