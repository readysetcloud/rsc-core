import {
  PutCommand,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  SnapshotStorage,
  SnapshotLocation,
  Snapshot,
  SnapshotManifest,
} from '@strands-agents/sdk';
import { ddb, requireTableName } from '../aws/ddb.js';

const SCHEMA_VERSION = '1.0';
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day retention, mirrors turns.

/**
 * A DynamoDB-backed implementation of the Strands-TS `SnapshotStorage`
 * interface. Passed to a `SessionManager`, it persists agent state snapshots so
 * a conversation resumes across WebSocket connections and cold starts — the job
 * AgentCore Memory did for the Python agent, now owned here.
 *
 * A `SnapshotLocation` is `{ sessionId, scope, scopeId }`; the session id keys
 * the partition and scope/scopeId ride in the sort key, so `deleteSession`
 * (which receives only a sessionId) wipes every scope with one partition query.
 *
 * ```
 * pk = SESSION#{sessionId}
 * sk = SNAPSHOT#{scope}#{scopeId}#{snapshotId}   one row per snapshot
 * sk = LATEST#{scope}#{scopeId}                  pointer to newest snapshot
 * sk = MANIFEST#{scope}#{scopeId}                the session manifest
 * ```
 */
export class DynamoSnapshotStorage implements SnapshotStorage {
  private pk(location: SnapshotLocation): string {
    return `SESSION#${location.sessionId}`;
  }

  private scopePrefix(location: SnapshotLocation): string {
    return `${location.scope}#${location.scopeId}`;
  }

  private snapshotSk(location: SnapshotLocation, snapshotId: string): string {
    return `SNAPSHOT#${this.scopePrefix(location)}#${snapshotId}`;
  }

  private latestSk(location: SnapshotLocation): string {
    return `LATEST#${this.scopePrefix(location)}`;
  }

  private manifestSk(location: SnapshotLocation): string {
    return `MANIFEST#${this.scopePrefix(location)}`;
  }

  private expiresAt(): number {
    return Math.floor(Date.now() / 1000) + TTL_SECONDS;
  }

  /** Writes a snapshot row, and (when `isLatest`) updates the LATEST pointer. */
  async saveSnapshot(params: {
    location: SnapshotLocation;
    snapshotId: string;
    isLatest: boolean;
    snapshot: Snapshot;
  }): Promise<void> {
    const TableName = requireTableName();
    const { location, snapshotId, isLatest, snapshot } = params;
    const pk = this.pk(location);
    const expiresAt = this.expiresAt();

    await ddb.send(new PutCommand({
      TableName,
      Item: {
        pk,
        sk: this.snapshotSk(location, snapshotId),
        entity: 'Snapshot',
        snapshotId,
        snapshot,
        expiresAt,
      },
    }));

    if (isLatest) {
      await ddb.send(new PutCommand({
        TableName,
        Item: {
          pk,
          sk: this.latestSk(location),
          entity: 'SnapshotPointer',
          snapshotId,
          expiresAt,
        },
      }));
    }
  }

  /** Loads a snapshot by id, or the latest one (via the LATEST pointer) when no id is given. */
  async loadSnapshot(params: {
    location: SnapshotLocation;
    snapshotId?: string;
  }): Promise<Snapshot | null> {
    const TableName = requireTableName();
    const { location } = params;
    const pk = this.pk(location);

    let id = params.snapshotId;
    if (!id) {
      const pointer = await ddb.send(new GetCommand({
        TableName,
        Key: { pk, sk: this.latestSk(location) },
      }));
      id = pointer.Item?.snapshotId as string | undefined;
      if (!id) return null;
    }

    const result = await ddb.send(new GetCommand({
      TableName,
      Key: { pk, sk: this.snapshotSk(location, id) },
    }));
    return result.Item ? (result.Item.snapshot as Snapshot) : null;
  }

  /** Lists snapshot ids under a location, optionally paginated by `limit`/`startAfter`. */
  async listSnapshotIds(params: {
    location: SnapshotLocation;
    limit?: number;
    startAfter?: string;
  }): Promise<string[]> {
    const TableName = requireTableName();
    const { location, limit, startAfter } = params;
    const pk = this.pk(location);
    const prefix = `SNAPSHOT#${this.scopePrefix(location)}#`;

    const result = await ddb.send(new QueryCommand({
      TableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
      ...(startAfter
        ? { ExclusiveStartKey: { pk, sk: this.snapshotSk(location, startAfter) } }
        : {}),
      ...(limit ? { Limit: limit } : {}),
    }));

    return (result.Items ?? []).map((item) => item.snapshotId as string);
  }

  /** Deletes every row (all scopes: snapshots, pointers, manifest) under a session. */
  async deleteSession(params: { sessionId: string }): Promise<void> {
    const TableName = requireTableName();
    const pk = `SESSION#${params.sessionId}`;

    // Query every row under the session partition (all scopes), then batch-delete.
    const result = await ddb.send(new QueryCommand({
      TableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'pk, sk',
    }));

    const keys = result.Items ?? [];
    for (let i = 0; i < keys.length; i += 25) {
      const batch = keys.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [TableName]: batch.map((Key) => ({ DeleteRequest: { Key } })),
        },
      }));
    }
  }

  /** Loads the session manifest, synthesizing a fresh one when none exists yet. */
  async loadManifest(params: { location: SnapshotLocation }): Promise<SnapshotManifest> {
    const TableName = requireTableName();
    const result = await ddb.send(new GetCommand({
      TableName,
      Key: { pk: this.pk(params.location), sk: this.manifestSk(params.location) },
    }));

    // Mirror the reference S3/File storage: synthesize a fresh manifest when
    // none exists yet rather than returning null.
    return (
      (result.Item?.manifest as SnapshotManifest | undefined) ?? {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /** Persists the session manifest. */
  async saveManifest(params: {
    location: SnapshotLocation;
    manifest: SnapshotManifest;
  }): Promise<void> {
    const TableName = requireTableName();
    await ddb.send(new PutCommand({
      TableName,
      Item: {
        pk: this.pk(params.location),
        sk: this.manifestSk(params.location),
        entity: 'SnapshotManifest',
        manifest: params.manifest,
        expiresAt: this.expiresAt(),
      },
    }));
  }
}
