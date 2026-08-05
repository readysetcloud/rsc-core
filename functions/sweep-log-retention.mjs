import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  PutRetentionPolicyCommand
} from '@aws-sdk/client-cloudwatch-logs';

// Both halves of this sweep hit low-TPS control-plane APIs — DescribeLogGroups
// while paging and PutRetentionPolicy once per unset group — against an
// account-wide limit shared with everything else in the account. Throttling is
// expected here, not exceptional.
//
// Adaptive mode is the reason for the config: on top of exponential backoff it
// runs a client-side rate limiter that throttle responses train downward, so
// the sweep settles into whatever rate the account will actually give it
// instead of retrying into the same wall. The limiter is shared across both
// operations on this one client, which matches the shared server-side limit.
// Ten attempts is roughly a minute of backoff on a fully throttled call.
const MAX_ATTEMPTS = 10;
const logs = new CloudWatchLogsClient({ retryMode: 'adaptive', maxAttempts: MAX_ATTEMPTS });

const RETENTION_IN_DAYS = Number(process.env.RETENTION_IN_DAYS ?? 3);
const EXCLUDED_PREFIXES = (process.env.EXCLUDED_PREFIXES ?? '')
  .split(',')
  .map(prefix => prefix.trim())
  .filter(Boolean);

// Stop with enough clock left to log the summary rather than dying mid-page.
const TIME_RESERVE_MS = 15000;

/**
 * Weekly sweep that puts every CloudWatch log group in this account+region on a
 * bounded retention.
 *
 * Log groups created outside of this template — by a console experiment, by a
 * service that makes its own group on first write, by a stack that has since
 * been deleted — default to "Never expire", and never-expiring logs are the
 * quiet half of most CloudWatch bills. Sweeping on a schedule fixes the whole
 * account without every producer having to remember, including the ones that
 * are not ours to change.
 *
 * The sweep only ever *sets* retention, so a group already at the target is
 * skipped and the run is idempotent — a retry after a partial pass costs a
 * DescribeLogGroups walk and nothing else. Groups that must keep their logs
 * longer belong in EXCLUDED_PREFIXES; anything else with a deliberate
 * retention will be overwritten on the next Sunday, by design.
 */
export const handler = async (event, context) => {
  const summary = { scanned: 0, updated: 0, skipped: 0, failed: 0, throttled: 0 };
  let outOfTime = false;
  let throttled = false;

  let nextToken;
  do {
    // A page walk under throttling can spend a minute inside one call once the
    // SDK's backoff stretches out, so the clock is checked before asking for a
    // page as well as before each write.
    if (context.getRemainingTimeInMillis() < TIME_RESERVE_MS) {
      outOfTime = true;
      break;
    }

    let response;
    try {
      // 50 is the most DescribeLogGroups will return, so this is the fewest
      // list calls the sweep can make — the cheapest throttling defense there is.
      response = await logs.send(new DescribeLogGroupsCommand({ limit: 50, nextToken }));
    } catch (err) {
      // Retries are exhausted by the time this lands. Everything already set is
      // durable, so report what got done before handing the error up — a bare
      // stack trace makes a throttled sweep look like a sweep that did nothing.
      console.error(`Log retention sweep (${RETENTION_IN_DAYS} days) stopped while listing log groups`, summary);
      throw err;
    }

    nextToken = response.nextToken;

    for (const group of response.logGroups ?? []) {
      summary.scanned++;

      if (group.retentionInDays === RETENTION_IN_DAYS || isExcluded(group.logGroupName)) {
        summary.skipped++;
        continue;
      }

      if (context.getRemainingTimeInMillis() < TIME_RESERVE_MS) {
        outOfTime = true;
        break;
      }

      try {
        await logs.send(new PutRetentionPolicyCommand({
          logGroupName: group.logGroupName,
          retentionInDays: RETENTION_IN_DAYS
        }));
        summary.updated++;
      } catch (err) {
        // Deleted between the describe and the put — the desired end state
        // (no unbounded logs) holds either way.
        if (err.name === 'ResourceNotFoundException') {
          summary.skipped++;
          continue;
        }

        // Ten attempts and about a minute of backoff already went into this one
        // call. If adaptive retries could not land it, the next group will not
        // do better in the same minute — so end the sweep instead of feeding
        // the same wall one group at a time until the clock runs out. Whatever
        // is left is picked up by the retry, or next Sunday.
        if (isThrottled(err)) {
          summary.throttled++;
          throttled = true;
          console.error(`Still throttled on '${group.logGroupName}' after ${MAX_ATTEMPTS} attempts; ending this sweep early`, summary);
          break;
        }

        summary.failed++;
        console.error(`Failed to set retention on '${group.logGroupName}'`, err);
      }
    }
  } while (nextToken && !outOfTime && !throttled);

  console.log(`Log retention sweep (${RETENTION_IN_DAYS} days)`, summary);

  if (outOfTime) {
    console.error('Ran out of time before finishing the sweep; the remaining groups are picked up next run', summary);
  }

  // Surfaced as invocation errors so a persistent problem shows up in metrics
  // instead of only in a log nobody reads. Both retries are safe: groups
  // already updated are skipped on the way back through. Throttling is called
  // out separately because it is the one failure that clears on its own — a
  // Scheduler retry a minute later is a real fix for it, and is not for the
  // permission error it would otherwise be lumped in with.
  if (throttled) {
    throw new Error(`Throttled by CloudWatch Logs after setting retention on ${summary.updated} log group(s)`);
  }

  if (summary.failed > 0) {
    throw new Error(`Failed to set retention on ${summary.failed} log group(s)`);
  }

  return summary;
};

const isExcluded = (logGroupName) => EXCLUDED_PREFIXES.some(prefix => logGroupName?.startsWith(prefix));

// Only reached once the SDK's own retries are spent, so this is "still
// throttled", not "throttled". CloudWatch Logs answers a rate limit with
// ThrottlingException; the status check catches the generic 429 shape.
const isThrottled = (err) => err.name === 'ThrottlingException' || err.$metadata?.httpStatusCode === 429;
