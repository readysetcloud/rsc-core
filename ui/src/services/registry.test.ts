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
      'fantasy',
      'updraft'
    ]);
  });
});

describe('fantasy service entry', () => {
  it('is live in the launcher', () => {
    const fantasy = readySetCloudServices.find((service) => service.id === 'fantasy');
    expect(fantasy?.href).toBe('https://fantasy.readysetcloud.io');
    expect(fantasy?.active).toBe(true);
  });
});

describe('updraft service entry', () => {
  it('is live in the launcher', () => {
    const updraft = readySetCloudServices.find((service) => service.id === 'updraft');
    expect(updraft?.href).toBe('https://updraft.readysetcloud.io');
    expect(updraft?.active).toBe(true);
  });
});
