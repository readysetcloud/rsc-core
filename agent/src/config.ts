// Central configuration for the assistant. Values come from the
// environment so the same package code runs identically whether it's
// hosted in AgentCore Runtime, invoked from a Lambda, or exercised in a
// test. Nothing here reaches out to AWS — it just reads env with sane
// defaults, mirroring the "read process.env at module scope" convention
// from readysetcloud/content-tracking.

/** Default chat model id. Override with the `BEDROCK_MODEL_ID` env var. */
export const DEFAULT_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';

/** AWS region for Bedrock calls. From `BEDROCK_REGION`, then `AWS_REGION`, else `us-east-1`. */
export const DEFAULT_REGION =
  process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';

/**
 * Max response tokens the model may generate. Override with `BEDROCK_MAX_TOKENS`.
 */
export const DEFAULT_MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS || 4096);

/** Default sampling temperature. Override with `BEDROCK_TEMPERATURE`. */
export const DEFAULT_TEMPERATURE = Number(process.env.BEDROCK_TEMPERATURE || 0.7);

/**
 * Default system prompt. Memory is handled by the Strands `memoryManager`
 * (AgentCore Memory): relevant facts/preferences from past sessions are injected
 * automatically before each turn, and a `search_memory` tool is available for
 * explicit recall.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant. You can have multi-turn conversations with users,
remembering context from previous messages and past sessions.

When responding:
- Be concise and helpful
- Relevant context from earlier conversations is provided to you automatically; use your search_memory tool if you need to look up something more specific
- Format responses in Markdown when appropriate
- If you're unsure about something, ask for clarification`;
