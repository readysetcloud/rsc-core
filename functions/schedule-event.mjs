import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand
} from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const scheduler = new SchedulerClient();
const eventBridge = new EventBridgeClient();

const SCHEDULE_GROUP = process.env.SCHEDULE_GROUP;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;
const EVENT_BUS_ARN = process.env.EVENT_BUS_ARN;

const SCHEDULE_DETAIL_TYPE = 'Schedule Event';
const CANCEL_DETAIL_TYPE = 'Cancel Scheduled Event';

/**
 * "Publish this event later" as a bus primitive.
 *
 * Any app that can `events:PutEvents` on the default bus can hand off a future
 * event — no Scheduler client, no IAM role of its own, no time-zone math in the
 * caller. Emit `Schedule Event` with a when and the event to fire; this creates
 * a one-time, self-deleting EventBridge Scheduler schedule that does the
 * PutEvents at that moment.
 *
 *   {
 *     "Source": "<your-app>",
 *     "DetailType": "Schedule Event",
 *     "Detail": {
 *       "name": "newsletter-rebuild-220",   // optional idempotency key
 *       "at": "2026-07-27T09:00:00",        // ISO instant, or naive + timezone
 *       "timezone": "America/Chicago",      // optional, default UTC
 *       "delay": "15m",                     // alternative to `at`
 *       "whenPast": "send",                 // send (default) | skip | error
 *       "event": {
 *         "source": "<defaults to this event's source>",
 *         "detailType": "Trigger Site Rebuild",
 *         "detail": { "issueNumber": 220 }
 *       }
 *     }
 *   }
 *
 * Re-emitting with the same `name` moves the existing schedule instead of
 * failing, so a re-run of the caller's workflow is safe. `Cancel Scheduled
 * Event` with `{ "name": "..." }` removes one before it fires.
 *
 * Trust: the schedule fires a PutEvents on the same account-internal bus the
 * caller already had to reach to get here, so this grants no authority beyond a
 * delay — the Scheduler role is scoped to that single action.
 */
export const handler = async (event) => {
  const detail = event?.detail;
  if (!detail) {
    console.error('Schedule request has no detail; ignoring', { id: event?.id });
    return;
  }

  try {
    if (event['detail-type'] === CANCEL_DETAIL_TYPE) {
      await cancel(detail);
      return;
    }

    await schedule(detail, event);
  } catch (err) {
    // A malformed request never succeeds on retry, so it is logged and dropped
    // rather than rethrown into EventBridge's 24-hour retry. Scheduler's own
    // ValidationException (a time too far out, a name it still won't take) is
    // the same class of problem, just caught one layer down.
    if (err instanceof RequestError || err.name === 'ValidationException') {
      console.error(err.message, { id: event?.id, detail });
      return;
    }

    console.error('Failed to handle schedule request', { id: event?.id, err });
    throw err;
  }
};

class RequestError extends Error { }

const cancel = async (detail) => {
  const name = getScheduleName(detail);
  if (!name) {
    throw new RequestError('Cancel request must include the `name` of the schedule to remove');
  }

  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: SCHEDULE_GROUP }));
    console.log(`Cancelled scheduled event '${name}'`);
  } catch (err) {
    // Already fired (schedules self-delete) or already cancelled — either way
    // the requested end state holds.
    if (err.name === 'ResourceNotFoundException') {
      console.log(`No schedule named '${name}' to cancel; nothing to do`);
      return;
    }

    throw err;
  }
};

const schedule = async (detail, event) => {
  const target = getTargetEvent(detail, event);
  const fireAt = getFireAt(detail);

  if (fireAt.getTime() <= Date.now()) {
    return handlePastTime(detail, target, fireAt);
  }

  const name = getScheduleName(detail) ?? `evt-${event.id}`;
  const input = {
    Name: name,
    GroupName: SCHEDULE_GROUP,
    // One-shot: Scheduler removes the schedule once it fires, so nothing
    // accumulates and callers never have to clean up.
    ActionAfterCompletion: 'DELETE',
    FlexibleTimeWindow: { Mode: 'OFF' },
    State: 'ENABLED',
    Description: `${target.detailType} from ${target.source}${detail.timezone ? ` (requested for ${detail.timezone})` : ''}`,
    // The instant is resolved here, so the expression is always in UTC — one
    // frame of reference for both the past check above and Scheduler.
    ScheduleExpression: `at(${fireAt.toISOString().slice(0, 19)})`,
    ScheduleExpressionTimezone: 'UTC',
    Target: {
      Arn: EVENT_BUS_ARN,
      RoleArn: SCHEDULER_ROLE_ARN,
      EventBridgeParameters: {
        Source: target.source,
        DetailType: target.detailType
      },
      Input: JSON.stringify(target.detail)
    }
  };

  try {
    await scheduler.send(new CreateScheduleCommand(input));
    console.log(`Scheduled '${target.detailType}' as '${name}' for ${fireAt.toISOString()}`);
  } catch (err) {
    // Same name again: a workflow re-run or a changed send time. Move the
    // existing schedule rather than failing the caller.
    if (err.name === 'ConflictException') {
      await scheduler.send(new UpdateScheduleCommand(input));
      console.log(`Moved '${name}' to ${fireAt.toISOString()}`);
      return;
    }

    throw err;
  }
};

const handlePastTime = async (detail, target, fireAt) => {
  const whenPast = detail.whenPast ?? 'send';

  if (whenPast === 'skip') {
    console.log(`${fireAt.toISOString()} has passed; skipping '${target.detailType}' per whenPast=skip`);
    return;
  }

  if (whenPast === 'error') {
    throw new RequestError(`${fireAt.toISOString()} has already passed and whenPast=error`);
  }

  // Default: the moment being scheduled for is the point, so a request that
  // arrives late still fires — dropping it silently loses the work.
  console.log(`${fireAt.toISOString()} has passed; publishing '${target.detailType}' now`);
  const response = await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: target.source,
      DetailType: target.detailType,
      Detail: JSON.stringify(target.detail)
    }]
  }));

  if (response.FailedEntryCount > 0) {
    console.error(response.Entries);
    throw new Error(`Failed to publish '${target.detailType}'`);
  }
};

const getTargetEvent = (detail, event) => {
  const target = detail.event ?? {};
  const detailType = target.detailType ?? target['detail-type'];
  if (!detailType) {
    throw new RequestError('Schedule request must include `event.detailType`');
  }

  // Scheduling a schedule request is a loop that only shows up as a runaway
  // bill, and the useful version of it (a chain longer than Scheduler allows)
  // is better written explicitly.
  if (detailType === SCHEDULE_DETAIL_TYPE) {
    throw new RequestError(`Cannot schedule a '${SCHEDULE_DETAIL_TYPE}' event`);
  }

  return {
    // Callers usually want the delayed event attributed to themselves, so the
    // requesting event's source is the default.
    source: target.source ?? event.source,
    detailType,
    detail: target.detail ?? {}
  };
};

// Scheduler names allow [0-9a-zA-Z-_.] up to 64 characters.
const getScheduleName = (detail) => {
  if (!detail.name) {
    return;
  }

  const name = `${detail.name}`.replace(/[^0-9a-zA-Z\-_.]/g, '-').slice(0, 64);
  if (!name) {
    throw new RequestError(`'${detail.name}' has no characters usable in a schedule name`);
  }

  return name;
};

const getFireAt = (detail) => {
  if (detail.delay) {
    return new Date(Date.now() + parseDelay(detail.delay));
  }

  if (!detail.at) {
    throw new RequestError('Schedule request must include either `at` or `delay`');
  }

  const at = `${detail.at}`.trim();
  // A bare date means the start of that day in the requested zone.
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00` : at;

  // An offset (`Z` or `±HH:MM`) already pins the instant; anything else is wall
  // time in `timezone`.
  const fireAt = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp)
    ? new Date(stamp)
    : toInstant(stamp, detail.timezone ?? 'UTC');

  if (isNaN(fireAt.getTime())) {
    throw new RequestError(`'${detail.at}' is not a usable date/time`);
  }

  return fireAt;
};

// "90s" | "15m" | "2h" | "3d", or combined ("1h30m"). A bare number is seconds.
const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const parseDelay = (delay) => {
  const value = `${delay}`.trim().toLowerCase();
  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const parts = value.match(/^(\d+[smhd])+$/) && [...value.matchAll(/(\d+)([smhd])/g)];
  if (!parts?.length) {
    throw new RequestError(`'${delay}' is not a usable delay (expected e.g. 90s, 15m, 2h, 3d)`);
  }

  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * UNITS[unit], 0);
};

// Milliseconds a zone is ahead of UTC at a given instant, read out of Intl so
// the zone's DST rules apply without a date library.
const getZoneOffset = (instant, timeZone) => {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find(part => part.type === 'timeZoneName').value;

  // Zones sitting exactly on UTC render as a bare "GMT" with no offset to parse.
  const parts = offset.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!parts) {
    return 0;
  }

  const [, sign, hours, minutes] = parts;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 3600000 + Number(minutes) * 60000);
};

// The instant at which a wall-clock time happens in `timeZone`: guess UTC, then
// correct by that zone's offset. The second pass settles the guess when the
// first landed on the wrong side of a DST transition.
const toInstant = (stamp, timeZone) => {
  const utcGuess = new Date(`${stamp}Z`);
  if (isNaN(utcGuess.getTime())) {
    return utcGuess;
  }

  try {
    const firstPass = new Date(utcGuess.getTime() - getZoneOffset(utcGuess, timeZone));
    return new Date(utcGuess.getTime() - getZoneOffset(firstPass, timeZone));
  } catch {
    throw new RequestError(`'${timeZone}' is not a usable IANA time zone`);
  }
};
