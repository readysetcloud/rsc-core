import { getTask, toTaskResult } from '@readysetcloud/agent/memory';

/**
 * Reads an autonomous task's status/result.
 *
 *   GET /agent/tasks/{taskId}
 *
 * A convenience for the `wait:false` (or timed-out `wait`) flow: the caller holds
 * a taskId and wants to check on it without subscribing to the "Agent Task
 * Completed" event. Ownership is enforced — the caller must either be the task's
 * `user` principal or the `createdBy` launcher (the human who started a gated
 * `system` task); anything else 404s (don't leak a task's existence). This is a
 * same-stack read of the core table, so it never crosses a permissions boundary.
 */
export const handler = async (event) => {
  const userId = event.requestContext?.authorizer?.claims?.sub ?? event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) {
    return response(401, { message: 'Unauthorized' });
  }

  const taskId = event.pathParameters?.taskId;
  if (!taskId) {
    return response(400, { message: 'taskId is required' });
  }

  try {
    const task = await getTask(taskId);
    // A missing task and a task the caller can't read are indistinguishable —
    // both 404, so a guessed id can't confirm a task exists. Readable when the
    // caller owns it (user principal) or launched it (createdBy on a system task).
    const owns = task?.principal?.type === 'user' && task.principal.id === userId;
    const launched = task?.createdBy === userId;
    if (!task || (!owns && !launched)) {
      return response(404, { message: 'Task not found' });
    }
    return response(200, toTaskResult(task));
  } catch (error) {
    console.error('Failed to get agent task', error);
    return response(500, { message: 'Failed to get agent task' });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});
