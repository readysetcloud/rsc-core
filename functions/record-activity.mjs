import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';

const eventBridge = new EventBridgeClient();

/**
 * Authenticated ingress for gamification activity. Lets client-side apps record
 * activity ("I completed a lesson", "I visited this app") without needing their
 * own EventBridge access. The user is taken from the verified JWT — never the
 * body — then the activity is emitted as a "Track Activity" event that the
 * rules engine (process-activity) consumes.
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

  const { action, count, value, service } = body;
  if (!action || typeof action !== 'string') {
    return response(400, { message: 'action is required' });
  }

  // Client-supplied id enables exactly-once counting across retries.
  const id = body.id ?? randomUUID();

  await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'rsc-core',
        DetailType: 'Track Activity',
        Detail: JSON.stringify({
          id,
          userId,
          action,
          ...(count != null && { count }),
          ...(value != null && { value }),
          ...(service && { service })
        })
      }
    ]
  }));

  return response(202, { id });
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
