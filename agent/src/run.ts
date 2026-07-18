import { Agent, BedrockModel, type AgentConfig } from '@strands-agents/sdk';
import type { z } from 'zod';
import {
  DEFAULT_MODEL_ID,
  DEFAULT_REGION,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_SYSTEM_PROMPT,
} from './config.js';

// A stateless, server-side, one-shot invocation of the agent. Where
// `handleUserMessage` (agent.ts) streams a chat turn to a browser and
// `runAgentTask` (task.ts) wraps a run in a durable, idempotent task record,
// `runAgent` is the bare primitive: build a Strands `Agent`, run one turn to
// completion, hand back the answer. No session manager, no snapshots, no
// DynamoDB — nothing persists, so it needs no table and leaves no trace.
//
// This is the shape a server-side orchestrator (e.g. a multi-lens content
// review engine running in a Lambda) reaches for when it wants to fan a single
// input across several independent analyses, each an isolated call:
//
//   - a one-shot **structured** analysis (grammar, LLM-detection) — pass an
//     `outputSchema` and get a validated object back, no prose parsing;
//   - a **tool-using** analysis (fact-checking over web search/fetch) — pass
//     `tools` and cap the loop with `maxIterations`;
//   - a **per-lens model** — pass `modelId` to pin a Pro- vs Lite-tier model.
//
// Trusted context (a `tenantId`, the caller's `sub`) is injected through
// `invocationState`, which the SDK threads to every tool's execution context.
// Because it is not a tool input parameter, the model can neither see nor
// forge it — trusted code sets it, tool handlers read it.

/** Options for {@link runAgent}. */
export interface RunAgentOptions {
  /** The input the agent runs against (the content/instruction for this call). */
  input: string;
  /** System prompt; defaults to {@link DEFAULT_SYSTEM_PROMPT}. */
  systemPrompt?: string;
  /** Model id for this call; defaults to {@link DEFAULT_MODEL_ID}. Pin it per lens. */
  modelId?: string;
  /** Sampling temperature; defaults to {@link DEFAULT_TEMPERATURE}. */
  temperature?: number;
  /** Max response tokens; defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /** Bedrock region; defaults to {@link DEFAULT_REGION}. */
  region?: string;
  /**
   * Tools to expose for this call. Accepts anything the Strands `Agent` does — a
   * `tool()`, an `McpClient`, or a sub-`Agent` — so a lens can fact-check over an
   * MCP web-search gateway or call first-party handlers. Omit for a pure
   * (tool-free) structured/text analysis.
   */
  tools?: AgentConfig['tools'];
  /**
   * Zod schema the final answer is validated against. When set, the SDK forces
   * the model to emit against the schema and {@link RunAgentResult.output} is the
   * validated object (not prose). When omitted, `output` is the response text.
   */
  outputSchema?: z.ZodType;
  /**
   * Upper bound on agent-loop iterations (a turn = one model call plus any tool
   * execution that follows), mapped to the SDK's per-invocation `limits.turns`.
   * The contract for bounded tool loops: a fact lens that keeps searching can't
   * run away. Omit for no cap. Must be a positive integer when set.
   */
  maxIterations?: number;
  /**
   * Trusted, request-scoped context threaded to every tool's execution context
   * (`context.invocationState`) and returned on the result. This is the
   * injection point for values the model must not supply or forge — a
   * `tenantId`, the caller's verified `sub`. Tool handlers read it from context;
   * it is never exposed to the model as an input parameter.
   */
  invocationState?: Record<string, unknown>;
  /**
   * External abort signal (e.g. a request-deadline timeout). When it fires the
   * run stops at the next checkpoint and the call rejects.
   */
  cancelSignal?: AbortSignal;
}

/** Result of a {@link runAgent} call. */
export interface RunAgentResult<T = unknown> {
  /**
   * The run's answer: the schema-validated object when `outputSchema` was passed,
   * otherwise the response text.
   */
  output: T;
  /** The response's string form (JSON for a structured result), always present. */
  text: string;
  /** Whether {@link output} is a schema-validated object (true) or text (false). */
  structured: boolean;
  /** The final model stop reason (`'endTurn'`, `'limitTurns'`, …). */
  stopReason: string;
  /** The `invocationState` after the run (tools/hooks may have mutated it). */
  invocationState: Record<string, unknown>;
}

/**
 * Runs one stateless turn of the agent to completion and returns its answer.
 *
 * With an `outputSchema` the result is the validated object; the SDK forces the
 * structured-output tool and throws `StructuredOutputError` if the model can't
 * produce a conforming result even after being forced — so a resolved call is a
 * schema-valid one. With `tools`, cap the loop with `maxIterations`. Inject
 * trusted per-call context (tenant, caller identity) through `invocationState`.
 *
 * Nothing here persists: no session manager, no snapshot storage, no table.
 * Construct-and-discard per call — ideal for a server-side orchestrator running
 * many independent analyses over one input.
 */
export async function runAgent<Schema extends z.ZodType>(
  options: RunAgentOptions & { outputSchema: Schema },
): Promise<RunAgentResult<z.output<Schema>>>;
export async function runAgent(
  options: RunAgentOptions & { outputSchema?: undefined },
): Promise<RunAgentResult<string>>;
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const {
    input,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    modelId = DEFAULT_MODEL_ID,
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    region = DEFAULT_REGION,
    tools = [],
    outputSchema,
    maxIterations,
    invocationState,
    cancelSignal,
  } = options;

  if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1)) {
    throw new Error('runAgent: maxIterations must be a positive integer when provided');
  }

  const agent = new Agent({
    model: new BedrockModel({ region, modelId, maxTokens, temperature }),
    systemPrompt,
    tools: tools ?? [],
  });

  const result = await agent.invoke(input, {
    ...(outputSchema ? { structuredOutputSchema: outputSchema } : {}),
    ...(maxIterations !== undefined ? { limits: { turns: maxIterations } } : {}),
    ...(invocationState ? { invocationState } : {}),
    ...(cancelSignal ? { cancelSignal } : {}),
  });

  const text = result.toString();

  if (outputSchema) {
    // The SDK populates `structuredOutput` on success and throws
    // StructuredOutputError otherwise; guard defensively so a schema request
    // never silently degrades to prose.
    if (result.structuredOutput === undefined) {
      throw new Error('runAgent: an outputSchema was provided but the model returned no structured output');
    }
    return {
      output: result.structuredOutput,
      text,
      structured: true,
      stopReason: result.stopReason,
      invocationState: result.invocationState,
    };
  }

  return {
    output: text,
    text,
    structured: false,
    stopReason: result.stopReason,
    invocationState: result.invocationState,
  };
}
