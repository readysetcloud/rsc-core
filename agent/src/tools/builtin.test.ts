import { describe, it, expect } from 'vitest';
import {
  builtinTools,
  BUILTIN_TOOL_NAMES,
  httpRequest,
  notebook,
} from './builtin.js';
import { resolveTools, type ToolContext } from './registry.js';

// These wrap the SDK's vended tools, so we don't re-test the tools themselves —
// we assert the packaging contract: the right names are registered, each factory
// yields the shared vended instance, and the map drops cleanly into resolveTools.
describe('builtinTools', () => {
  const context: ToolContext = { sessionId: 'sess-1', userId: 'user-1' };

  it('registers exactly the safe generic tools by their SDK names', () => {
    expect(BUILTIN_TOOL_NAMES.sort()).toEqual(['http_request', 'notebook']);
    // bash / file_editor are intentionally not exposed in a hosted runtime.
    expect(builtinTools).not.toHaveProperty('bash');
    expect(builtinTools).not.toHaveProperty('file_editor');
  });

  it('each factory returns the shared vended tool instance', () => {
    expect(builtinTools.http_request(context)).toBe(httpRequest);
    expect(builtinTools.notebook(context)).toBe(notebook);
  });

  it('resolves through the registry resolver like any host-owned tool', () => {
    const tools = resolveTools(['http_request', 'notebook'], builtinTools, context);
    expect(tools).toEqual([httpRequest, notebook]);
  });

  it('re-exports instances that carry their advertised tool names', () => {
    expect(httpRequest.name).toBe('http_request');
    expect(notebook.name).toBe('notebook');
  });
});
