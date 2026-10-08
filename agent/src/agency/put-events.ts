import { PutEventsCommand, type PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { eventBridge } from '../aws/events.js';

/**
 * An event EventBridge rejected individually. `PutEvents` can answer 200 while
 * failing an entry (`FailedEntryCount` > 0), so a send that ignores the
 * per-entry result can lose an event silently. `code` is the entry's
 * `ErrorCode` (`ThrottlingException`, `InternalFailure`, …), which
 * `isRetryableError` reads.
 */
export class PutEventsEntryError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(`EventBridge rejected the event: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'PutEventsEntryError';
    this.code = code;
  }
}

/** `PutEvents` that throws when any entry was not accepted. */
export async function putEvents(entries: PutEventsRequestEntry[]): Promise<void> {
  const response = await eventBridge.send(new PutEventsCommand({ Entries: entries }));
  if ((response?.FailedEntryCount ?? 0) > 0) {
    const failed = response?.Entries?.find((entry) => entry.ErrorCode);
    throw new PutEventsEntryError(failed?.ErrorCode ?? 'InternalFailure', failed?.ErrorMessage);
  }
}
