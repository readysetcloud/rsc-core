import type { Agent } from '@strands-agents/sdk';

// The buffered sibling of handleUserMessage (agent.ts). Where a chat turn streams
// wire messages to a browser, an autonomous task runs the agent to completion and
// returns the final text — no transport, no streaming. The host (the AgentCore
// runtime, a Lambda, a test) records the durable row and emits the result event
// around this call; this function is just "run one turn and give me the answer".

/** Options for {@link handleTask}. */
export interface HandleTaskOptions {
  /** The instruction the agent runs. */
  request: string;
}

/**
 * Runs one autonomous turn end-to-end: invokes the agent, buffers the response,
 * flushes the memory manager so the turn is durably captured, and returns the
 * assistant text.
 *
 * Mirrors {@link handleUserMessage} but with no streaming — the caller wants the
 * whole result, not a stream of frames. As with a chat turn, memory extraction
 * is fire-and-forget, so we `flush()` at this boundary to guarantee durability
 * even if the runtime is reclaimed afterward (`flush()` is a no-op when no store
 * has extraction configured).
 *
 * Build the agent once per task with `createAssistant` (the host loads the
 * session/task config, tools, and memory manager), then pass it here.
 */
export async function handleTask(
  agent: Agent,
  { request }: HandleTaskOptions,
): Promise<string> {
  const result = await agent.invoke(request);

  await agent.memoryManager?.flush();

  return result.toString();
}
