import { describe, expect, it, vi } from 'vitest';
import { createBadgeClient } from './client';

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

describe('createBadgeClient', () => {
  it('sends the bearer token on per-user requests', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => okJson({ points: 10 }));
    const client = createBadgeClient({
      baseUrl: 'https://api.example.com/',
      getToken: () => 'tok-123',
      fetch: fetchMock as unknown as typeof fetch
    });

    await client.getChest();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/badges/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('does not send auth on the public catalog request', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => okJson({ version: 1, badges: [], levels: [] }));
    const client = createBadgeClient({
      baseUrl: 'https://api.example.com',
      getToken: () => 'tok-123',
      fetch: fetchMock as unknown as typeof fetch
    });

    await client.getCatalog();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/badges/catalog');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('posts activity payloads as JSON', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => okJson({ id: 'evt-1' }));
    const client = createBadgeClient({
      baseUrl: 'https://api.example.com',
      getToken: async () => 'tok-123',
      fetch: fetchMock as unknown as typeof fetch
    });

    const result = await client.recordActivity({ action: 'lesson.completed', service: 'bootcamp' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/badges/activity');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'lesson.completed', service: 'bootcamp' });
    expect(result).toEqual({ id: 'evt-1' });
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response)
    );
    const client = createBadgeClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(client.getCatalog()).rejects.toThrow(/500/);
  });
});
