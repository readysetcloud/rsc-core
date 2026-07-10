import { describe, expect, it } from 'vitest';
import { readySetCloudServices } from './registry';

describe('readySetCloudServices', () => {
  it('includes the default ReadySetCloud app manifest entries', () => {
    expect(readySetCloudServices.map((service) => service.id)).toEqual([
      'readysetcloud',
      'booked',
      'outboxed',
      'bootcamp',
      'olivias-garden-foundation'
    ]);
  });
});
