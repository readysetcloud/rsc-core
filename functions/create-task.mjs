import { setTimeout as sleep } from 'node:timers/promises';
import { createTask, requestAgentTask, getTask, toTaskResult } from '@readysetcloud/agent/memory';

// Budget for the synchronous `wait` path, kept safely under the CoreApi (REST)
// ~29s integration timeout. If the run isn't done by then we return 202 and the
// result still arrives on the "Agent Task Completed" event — never a hard hang.
const WAIT_BUDGET_MS = 25_000;
const POLL_INTERVAL_MS = 500;

/**
 * Triggers an autonomous (non-chat) agent task and, by default, waits briefly for
 * the result.
 *
 *   POST /agent/tasks  { request, sessionId?, wait?, system? }
 *
 * Identity. By default the verified caller (Cognito sub) is the task's `user`
 * principal, so the run inherits that user's memory scoping and any session
 * ownership. Passing `system` requests a **system-scoped** run (id = a service,
 * e.g. `booked`) — a privileged capability, so it is gated: only a caller
 * allowlisted for that system id in SYSTEM_TASK_PRINCIPALS may assert it (empty
 * allowlist rejects all — opt in explicitly, mirroring MCP_ALLOWED_HOSTS). The
 * run then acts as the system, but the launching sub is recorded as `createdBy`
 * so this human can still read the task back. This is the host-side authz gate;
 * the @readysetcloud/agent package stays policy-free. A first-party backend that
 * doesn't want this gate emits a "Run Agent Task" event directly (the account-
 * internal bus is already trusted to assert a principal).
 *
 * The run always goes through the event → runtime path (so it completes and
 * announces its result regardless of whether anyone is still waiting). `wait`
 * just polls this stack's own task row for a quick inline answer:
 *
 *   - wait:true (default) & finishes < ~25s → 200 with the result envelope
 *   - wait:false, or a slower run             → 202 { taskId, status } + the event
 *
 * Either way the response is the same shape (see toTaskResult), and `status`
 * tells the caller whether the answer is in hand or coming on the bus. No caller
 * ever reads this table across the permissions boundary — delivery is inline or
 * by event.
 */
export const handler = async (event) => {
  const userId = event.requestContext?.authorizer?.claims?.sub ?? event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return response(401, { message: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return response(400, { message: 'Invalid JSON body' });
  }

  const { request, sessionId, wait = true, system } = body;
  if (!request || typeof request !== 'string') {
    return response(400, { message: 'request is required' });
  }

  // Resolve the principal, gating a system-scoped request behind the allowlist.
  let principal;
  let createdBy;
  if (system !== undefined) {
    if (typeof system !== 'string' || !system) {
      return response(400, { message: 'system must be a non-empty string' });
    }
    if (!isSystemTaskAllowed(userId, system)) {
      return response(403, { message: `Not allowed to run tasks as system: ${system}` });
    }
    principal = { type: 'system', id: system };
    createdBy = userId; // the human launcher — the run itself acts as the system
  } else {
    principal = { type: 'user', id: userId };
  }

  try {
    // Record PENDING (so a GET sees it immediately) and trigger the run.
    const task = await createTask({ principal, request, sessionId, createdBy });
    await requestAgentTask({ taskId: task.taskId, principal, request, sessionId });

    if (!wait) {
      return response(202, toTaskResult(task));
    }

    // Poll our own table for a terminal result within the budget.
    const deadline = Date.now() + WAIT_BUDGET_MS;
    let current = task;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const latest = await getTask(task.taskId);
      if (latest) current = latest;
      if (current.status === 'COMPLETED' || current.status === 'FAILED') {
        return response(200, toTaskResult(current));
      }
    }

    // Still running — hand back a ticket; the result will land on the event.
    return response(202, toTaskResult(current));
  } catch (error) {
    console.error('Failed to create agent task', error);
    return response(500, { message: 'Failed to create agent task' });
  }
};

/**
 * Whether `userId` may launch a task as system `systemId`, per the
 * SYSTEM_TASK_PRINCIPALS allowlist. The allowlist is comma-separated
 * `sub:systemId` grants; a `sub:*` grant permits any system id for that sub. An
 * empty/unset allowlist permits nothing — system tasks are opt-in, so a
 * misconfiguration fails closed (no caller can escalate to a system principal).
 *
 * Example: `SYSTEM_TASK_PRINCIPALS = "abc-123:booked,svc-sub:*"` lets sub
 * `abc-123` run as `booked` only, and `svc-sub` run as any system.
 */
const isSystemTaskAllowed = (userId, systemId) => {
  const grants = (process.env.SYSTEM_TASK_PRINCIPALS ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  return grants.some((grant) => {
    const idx = grant.lastIndexOf(':');
    if (idx <= 0) return false; // malformed (needs sub:systemId)
    const sub = grant.slice(0, idx);
    const allowedSystem = grant.slice(idx + 1);
    return sub === userId && (allowedSystem === '*' || allowedSystem === systemId);
  });
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});
