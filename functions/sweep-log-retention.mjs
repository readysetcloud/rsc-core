import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  PutRetentionPolicyCommand
} from '@aws-sdk/client-cloudwatch-logs';

// PutRetentionPolicy is a low-TPS control-plane call and this sweep makes one
// per unset log group, so throttling is expected rather than exceptional.
// Adaptive retries let the SDK back off into the account's rate instead of
// burning the Lambda's clock on failures.
const logs = new CloudWatchLogsClient({ retryMode: 'adaptive', maxAttempts: 10 });

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
  const summary = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let outOfTime = false;

  let nextToken;
  do {
    const response = await logs.send(new DescribeLogGroupsCommand({ limit: 50, nextToken }));
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

        summary.failed++;
        console.error(`Failed to set retention on '${group.logGroupName}'`, err);
      }
    }
  } while (nextToken && !outOfTime);

  console.log(`Log retention sweep (${RETENTION_IN_DAYS} days)`, summary);

  if (outOfTime) {
    console.error('Ran out of time before finishing the sweep; the remaining groups are picked up next run', summary);
  }

  // Surfaced as an invocation error so a persistent permission or throttling
  // problem shows up in metrics instead of only in a log nobody reads. The
  // async retry is safe: updated groups are skipped on the way back through.
  if (summary.failed > 0) {
    throw new Error(`Failed to set retention on ${summary.failed} log group(s)`);
  }

  return summary;
};

const isExcluded = (logGroupName) => EXCLUDED_PREFIXES.some(prefix => logGroupName?.startsWith(prefix));
