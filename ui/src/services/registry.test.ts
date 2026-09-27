import { describe, expect, it } from 'vitest';
import { readySetCloudServices } from './registry';

describe('readySetCloudServices', () => {
  it('includes the default ReadySetCloud app manifest entries', () => {
    expect(readySetCloudServices.map((service) => service.id)).toEqual([
      'readysetcloud',
      'booked',
      'outboxed',
      'bootcamp',
      'olivias-garden-foundation',
      'fantasy'
    ]);
  });
});

describe('fantasy service entry', () => {
  it('stays hidden from the launcher until the app launches', () => {
    const fantasy = readySetCloudServices.find((service) => service.id === 'fantasy');
    expect(fantasy?.href).toBe('https://fantasy.readysetcloud.io');
    expect(fantasy?.active).toBe(false);
  });
});
