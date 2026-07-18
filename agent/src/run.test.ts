import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Capture what runAgent builds + how it invokes the SDK agent, and control the
// result. We fake Agent/BedrockModel and keep the rest of the SDK intact.
const invoke = vi.fn();
const agentConfigs: unknown[] = [];
const modelConfigs: unknown[] = [];

vi.mock('@strands-agents/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@strands-agents/sdk')>();
  return {
    ...actual,
    BedrockModel: class {
      constructor(config: unknown) {
        modelConfigs.push(config);
      }
    },
    Agent: class {
      constructor(config: unknown) {
        agentConfigs.push(config);
      }
      invoke = (...args: unknown[]) => invoke(...args);
    },
  };
});

const { runAgent } = await import('./run.js');

const makeResult = (over: Record<string, unknown> = {}) => ({
  toString: () => 'plain text answer',
  stopReason: 'endTurn',
  invocationState: {},
  structuredOutput: undefined,
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  agentConfigs.length = 0;
  modelConfigs.length = 0;
});

describe('runAgent', () => {
  it('returns response text when no schema is given', async () => {
    invoke.mockResolvedValue(makeResult({ toString: () => 'hello' }));

    const result = await runAgent({ input: 'say hi' });

    expect(invoke).toHaveBeenCalledWith('say hi', expect.any(Object));
    expect(result).toMatchObject({ output: 'hello', text: 'hello', structured: false, stopReason: 'endTurn' });
  });

  it('builds a stateless agent — no session manager, no storage', async () => {
    invoke.mockResolvedValue(makeResult());

    await runAgent({ input: 'x' });

    const config = agentConfigs[0] as Record<string, unknown>;
    expect(config).not.toHaveProperty('sessionManager');
    expect(config).not.toHaveProperty('memoryManager');
    expect(config).not.toHaveProperty('storage');
  });

  it('pins the per-call model id and passes prompt + tools through', async () => {
    invoke.mockResolvedValue(makeResult());
    const tool = { name: 'search' };

    await runAgent({
      input: 'x',
      modelId: 'us.anthropic.claude-pro',
      systemPrompt: 'You are the grammar lens.',
      tools: [tool] as never,
    });

    expect(modelConfigs[0]).toMatchObject({ modelId: 'us.anthropic.claude-pro' });
    const config = agentConfigs[0] as Record<string, unknown>;
    expect(config).toMatchObject({ systemPrompt: 'You are the grammar lens.', tools: [tool] });
  });

  it('enforces a schema and returns the validated object', async () => {
    const schema = z.object({ score: z.number(), issues: z.array(z.string()) });
    const structuredOutput = { score: 3, issues: ['comma splice'] };
    invoke.mockResolvedValue(makeResult({ structuredOutput, toString: () => JSON.stringify(structuredOutput) }));

    const result = await runAgent({ input: 'review this', outputSchema: schema });

    // The schema is forwarded to the SDK's per-invocation structured-output path.
    expect(invoke).toHaveBeenCalledWith('review this', expect.objectContaining({ structuredOutputSchema: schema }));
    expect(result.structured).toBe(true);
    expect(result.output).toEqual(structuredOutput);
  });

  it('throws when a schema was requested but no structured output came back', async () => {
    const schema = z.object({ score: z.number() });
    invoke.mockResolvedValue(makeResult({ structuredOutput: undefined }));

    await expect(runAgent({ input: 'x', outputSchema: schema })).rejects.toThrow(/no structured output/);
  });

  it('maps maxIterations to the SDK per-invocation turns limit', async () => {
    invoke.mockResolvedValue(makeResult());

    await runAgent({ input: 'x', maxIterations: 4 });

    expect(invoke).toHaveBeenCalledWith('x', expect.objectContaining({ limits: { turns: 4 } }));
  });

  it('rejects a non-positive / non-integer maxIterations before invoking', async () => {
    await expect(runAgent({ input: 'x', maxIterations: 0 })).rejects.toThrow(/positive integer/);
    await expect(runAgent({ input: 'x', maxIterations: 2.5 })).rejects.toThrow(/positive integer/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('threads trusted invocationState to the invocation and surfaces it back', async () => {
    const injected = { tenantId: 'tenant-42', sub: 'user-9' };
    invoke.mockResolvedValue(makeResult({ invocationState: injected }));

    const result = await runAgent({ input: 'x', invocationState: injected });

    expect(invoke).toHaveBeenCalledWith('x', expect.objectContaining({ invocationState: injected }));
    expect(result.invocationState).toEqual(injected);
  });

  it('omits optional invoke options when not provided', async () => {
    invoke.mockResolvedValue(makeResult());

    await runAgent({ input: 'x' });

    const opts = invoke.mock.calls[0][1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('structuredOutputSchema');
    expect(opts).not.toHaveProperty('limits');
    expect(opts).not.toHaveProperty('invocationState');
    expect(opts).not.toHaveProperty('cancelSignal');
  });
});
