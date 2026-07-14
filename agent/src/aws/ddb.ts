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

/** Returns {@link TABLE_NAME}, throwing a clear error if it is not set. */
export function requireTableName(): string {
  if (!TABLE_NAME) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return TABLE_NAME;
}
