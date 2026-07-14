import { describe, it, expect, vi } from 'vitest';
import { resolveTools, type ToolRegistry, type ToolContext } from './registry.js';

// The registry resolver is pure and SDK-agnostic — a factory can return any
// value (real tools are opaque SDK objects), so we assert on identity + context.
describe('resolveTools', () => {
  const context: ToolContext = { sessionId: 'sess-1', userId: 'user-1' };

  const registry = {
    alpha: vi.fn((ctx) => ({ tool: 'alpha', ctx })),
    beta: vi.fn(() => ({ tool: 'beta' })),
  } as unknown as ToolRegistry;

  it('resolves known names in order, passing the context to each factory', () => {
    const tools = resolveTools(['alpha', 'beta'], registry, context);
    expect(tools).toEqual([
      { tool: 'alpha', ctx: context },
      { tool: 'beta' },
    ]);
    expect(registry.alpha).toHaveBeenCalledWith(context);
  });

  it('skips unknown names instead of throwing', () => {
    const tools = resolveTools(['alpha', 'does-not-exist'], registry, context);
    expect(tools).toEqual([{ tool: 'alpha', ctx: context }]);
  });

  it('returns an empty array for undefined or empty selections', () => {
    expect(resolveTools(undefined, registry, context)).toEqual([]);
    expect(resolveTools([], registry, context)).toEqual([]);
  });
});
