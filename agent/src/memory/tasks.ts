import { randomUUID } from 'node:crypto';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, requireTableName } from '../aws/ddb.js';

// Durable records for an AUTONOMOUS (non-chat) agent run — the counterpart to
// session config (sessions.ts) for the request/response task path. A task is a
// one-shot "do something" invocation of the agent that goes through the same
// secure runtime, with no browser holding a socket. The row is the coordination
// point: it makes a run idempotent under at-least-once event delivery, records
// the result for a `GET /agent/tasks/{id}`, and carries status through its
// lifecycle. Delivery of the result to callers is by inline response (sync) or
// the "Agent Task Completed" event (async) — see task-events.ts; nobody reads
// this row across a stack boundary.
//
//   pk = TASK#{taskId}
//   sk = STATUS
//   entity = "AgentTask"
//
// Lifecycle (each transition is a conditional write, so a duplicate delivery or
// a concurrent invocation can never double-run the agent):
//
//   createTask   → PENDING   (optional; lets a GET see the task right after 202)
//   startTask    → RUNNING   (exclusive claim: PENDING/absent/FAILED → RUNNING)
//   finishTask   → COMPLETED | FAILED
//
// Results are needed only briefly, so the row's TTL is short relative to the
// 30-day session/snapshot retention.

/** DynamoDB `entity` discriminator for a task row. */
export const TASK_ENTITY = 'AgentTask';

// Results are short-lived; keep the row a day for a late GET, then let it expire.
const TASK_TTL_SECONDS = 24 * 60 * 60;

/** Lifecycle status of a task. */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/**
 * The identity a task runs as. Drives memory scoping, ownership checks, and MCP
 * `authHeader` propagation in the runtime.
 *
 * - `user` — a verified Cognito `sub`; reuses all per-user plumbing unchanged.
 * - `system` — a non-human service/app id (e.g. `booked`) for ecosystem tasks
 *   with no single owning user. Supplied by a trusted first-party caller, never
 *   a browser.
 */
export interface Principal {
  type: 'user' | 'system';
  /** Cognito `sub` (user) or service id (system). */
  id: string;
}

/**
 * The full stored task row. `AgentTaskResult` (below) is the small shape callers
 * and event consumers learn; this is the internal superset.
 */
export interface AgentTask {
  taskId: string;
  status: TaskStatus;
  /** Who the run acts as. */
  principal: Principal;
  /** The instruction the agent runs. */
  request: string;
  /** Optional session to run within (history/continuity); absent = one-shot. */
  sessionId?: string;
  /**
   * The verified identity that *launched* the task, when it differs from
   * {@link principal}. Set for a host-gated `system` task created over an API: the
   * run acts as the system, but this records the human caller so they can still
   * read it back (see the host's ownership check). Absent for a task whose
   * launcher is its principal (an ordinary user task) or a first-party backend.
   */
  createdBy?: string;
  /** Assistant output, present once COMPLETED. */
  output?: string;
  /** Failure message, present once FAILED. */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The one shape a caller/consumer learns: identical on the API response, the
 * table row, and the "Agent Task Completed" event detail. `output` is present
 * when `status` is COMPLETED, `error` when FAILED.
 */
export interface AgentTaskResult {
  taskId: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}

/** Projects the stored row (or any superset) down to the public result shape. */
export function toTaskResult(task: {
  taskId: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}): AgentTaskResult {
  return {
    taskId: task.taskId,
    status: task.status,
    ...(task.output !== undefined ? { output: task.output } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
  };
}

function taskKey(taskId: string) {
  return { pk: `TASK#${taskId}`, sk: 'STATUS' };
}

function ttl(now: number): number {
  return Math.floor(now / 1000) + TASK_TTL_SECONDS;
}

/** Options common to the task writes: which table, and a clock override for tests. */
interface TaskWriteOptions {
  /** Table to write to; defaults to the `TABLE_NAME` env var. */
  tableName?: string;
  /** Override the timestamp (epoch millis); defaults to `Date.now()`. */
  now?: number;
}

/** Options for {@link createTask}. */
export interface CreateTaskOptions extends TaskWriteOptions {
  /** Provide to use a specific id; a UUID is generated when omitted. */
  taskId?: string;
  /** Identity the run acts as. Required. */
  principal: Principal;
  /** The instruction the agent runs. Required. */
  request: string;
  /** Optional session to run the task within. */
  sessionId?: string;
  /**
   * The verified identity that launched the task, when it differs from
   * `principal` (e.g. the human who requested a host-gated `system` run). Lets
   * that caller read the task back even though the run acts as another principal.
   */
  createdBy?: string;
}

/**
 * Records a task as PENDING so a `GET /agent/tasks/{id}` sees it the moment the
 * caller gets its taskId back (before the runtime picks it up). Conditional on
 * the task not already existing, so a retry can't reset a run in flight. This
 * step is optional — the runtime's {@link startTask} upserts, so a task created
 * only there still works; PENDING just makes early status queryable.
 */
export async function createTask(options: CreateTaskOptions): Promise<AgentTask> {
  const { principal, request } = options;
  if (!principal?.id) throw new Error('createTask requires a principal');
  if (!request) throw new Error('createTask requires a request');

  const TableName = requireTableName(options.tableName);
  const now = options.now ?? Date.now();
  const taskId = options.taskId ?? randomUUID();

  const task: AgentTask = {
    taskId,
    status: 'PENDING',
    principal,
    request,
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.createdBy !== undefined ? { createdBy: options.createdBy } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName,
    Item: { ...taskKey(taskId), entity: TASK_ENTITY, ...task, expiresAt: ttl(now) },
    ConditionExpression: 'attribute_not_exists(pk)',
  }));

  return task;
}

/** Options for {@link startTask}: identifies the task and (for an upsert) its content. */
export interface StartTaskOptions extends TaskWriteOptions {
  taskId: string;
  /** Identity the run acts as — written when the row didn't already exist. */
  principal: Principal;
  /** The instruction — written when the row didn't already exist. */
  request: string;
  /** Optional session to run within — written when the row didn't already exist. */
  sessionId?: string;
}

/** Outcome of a {@link startTask} claim attempt. */
export type StartTaskResult =
  /** This invocation exclusively claimed the task; proceed to run it. */
  | { claimed: true }
  /**
   * Another invocation already owns or finished this task (duplicate delivery).
   * `existing` is the current row so the caller can return its result (COMPLETED)
   * or back off (RUNNING) instead of double-running the agent.
   */
  | { claimed: false; existing: AgentTask | null };

/**
 * Exclusively claims a task for this invocation, transitioning it to RUNNING.
 * Upserts, so it works whether or not {@link createTask} pre-wrote a PENDING row.
 *
 * The claim succeeds only from a non-active state — the row is absent, PENDING,
 * or a prior FAILED (a retry) — and DynamoDB serializes conditional writes on
 * the key, so exactly one of N duplicate deliveries wins and the rest get
 * `claimed: false`. This is the durable idempotency guard that stops an
 * at-least-once "Run Agent Task" event from running the agent (and its tools)
 * more than once. An in-memory cache in the runtime is only a fast path in front
 * of this; correctness lives here.
 */
export async function startTask(options: StartTaskOptions): Promise<StartTaskResult> {
  const { taskId, principal, request } = options;
  if (!taskId) throw new Error('startTask requires a taskId');
  if (!principal?.id) throw new Error('startTask requires a principal');

  const TableName = requireTableName(options.tableName);
  const now = options.now ?? Date.now();

  try {
    await ddb.send(new UpdateCommand({
      TableName,
      Key: taskKey(taskId),
      // Claim only from absent / PENDING / FAILED — never steal a RUNNING or
      // COMPLETED task. `if_not_exists` fills content + createdAt on a bare upsert.
      ConditionExpression:
        'attribute_not_exists(pk) OR #status = :pending OR #status = :failed',
      UpdateExpression:
        'SET #status = :running, entity = :entity, principal = :principal, ' +
        '#request = if_not_exists(#request, :request), sessionId = if_not_exists(sessionId, :sessionId), ' +
        'createdAt = if_not_exists(createdAt, :now), updatedAt = :now, expiresAt = :ttl',
      ExpressionAttributeNames: { '#status': 'status', '#request': 'request' },
      ExpressionAttributeValues: {
        ':running': 'RUNNING',
        ':pending': 'PENDING',
        ':failed': 'FAILED',
        ':entity': TASK_ENTITY,
        ':principal': principal,
        ':request': request,
        // DynamoDB rejects an undefined attribute value; a one-shot task has no
        // session, so persist an empty string and normalize it back to undefined on read.
        ':sessionId': options.sessionId ?? '',
        ':now': now,
        ':ttl': ttl(now),
      },
    }));
    return { claimed: true };
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return { claimed: false, existing: await getTask(taskId, options.tableName) };
    }
    throw err;
  }
}

/** Options for {@link finishTask}. */
export interface FinishTaskOptions extends TaskWriteOptions {
  taskId: string;
  /** Terminal status to record. */
  status: 'COMPLETED' | 'FAILED';
  /** Assistant output (COMPLETED). */
  output?: string;
  /** Failure message (FAILED). */
  error?: string;
}

/**
 * Records a task's terminal result. Conditional on the task still existing and
 * being RUNNING, so a late/duplicate finish can't overwrite a result or resurrect
 * an expired row. Returns the updated result shape.
 */
export async function finishTask(options: FinishTaskOptions): Promise<AgentTaskResult> {
  const { taskId, status } = options;
  if (!taskId) throw new Error('finishTask requires a taskId');

  const TableName = requireTableName(options.tableName);
  const now = options.now ?? Date.now();

  await ddb.send(new UpdateCommand({
    TableName,
    Key: taskKey(taskId),
    ConditionExpression: 'attribute_exists(pk) AND #status = :running',
    UpdateExpression:
      'SET #status = :status, #output = :output, #error = :error, updatedAt = :now, expiresAt = :ttl',
    ExpressionAttributeNames: { '#status': 'status', '#output': 'output', '#error': 'error' },
    ExpressionAttributeValues: {
      ':status': status,
      ':running': 'RUNNING',
      ':output': options.output ?? null,
      ':error': options.error ?? null,
      ':now': now,
      ':ttl': ttl(now),
    },
  }));

  return toTaskResult({
    taskId,
    status,
    ...(options.output !== undefined ? { output: options.output } : {}),
    ...(options.error !== undefined ? { error: options.error } : {}),
  });
}

/**
 * Loads a task row, or null if none exists (e.g. expired, or never created).
 * Does not enforce ownership — a caller compares `task.principal` against the
 * verified requester. Pass `tableName` to read from a specific table.
 */
export async function getTask(taskId: string, tableName?: string): Promise<AgentTask | null> {
  if (!taskId) return null;
  const TableName = requireTableName(tableName);

  const res = await ddb.send(new GetCommand({ TableName, Key: taskKey(taskId) }));
  if (!res.Item) return null;

  const item = res.Item;
  return {
    taskId: item.taskId as string,
    status: item.status as TaskStatus,
    principal: item.principal as Principal,
    request: item.request as string,
    // Normalize the empty-string placeholder written by startTask back to undefined.
    sessionId: (item.sessionId as string) || undefined,
    createdBy: (item.createdBy as string) || undefined,
    output: (item.output as string | null) ?? undefined,
    error: (item.error as string | null) ?? undefined,
    createdAt: item.createdAt as number,
    updatedAt: item.updatedAt as number,
  };
}
