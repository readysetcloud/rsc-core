import type { AgentStreamEventBody, SendMessage } from './protocol.js';

// Normalizes Strands-TS agent stream events into our wire protocol and
// drives a single conversation turn.
//
// Strands-TS `agent.stream()` yields a discriminated union of AgentStreamEvent
// (see @strands-agents/sdk types/agent.ts). Model tokens arrive wrapped in a
// `modelStreamUpdateEvent` envelope whose `.event` is the raw ModelStreamEvent
// (models/streaming.ts). We unwrap that and pick out two cases:
//   - modelContentBlockDeltaEvent + delta.type === "textDelta"   -> text token
//   - modelContentBlockStartEvent + start.type === "toolUseStart" -> tool use
//   - everything else                                            -> ignored
//
// NOTE: these type/field names are bound to @strands-agents/sdk v1.9. If a
// future bump renames an event, this normalizer is the single place to adjust —
// the wire protocol and the frontend stay untouched.

/** Minimal structural view of the Strands stream events we consume. */
export interface StrandsStreamEvent {
  type: string;
  /** For a `modelStreamUpdateEvent` envelope, the nested raw model event. */
  event?: StrandsStreamEvent;
  delta?: {
    type?: string;
    text?: string;
  };
  start?: {
    type?: string;
    name?: string;
    toolUseId?: string;
  };
  [key: string]: unknown;
}

const MODEL_STREAM_UPDATE = 'modelStreamUpdateEvent';

/** Something we can iterate for stream events (an `agent.stream()` result). */
export type StrandsStream = AsyncIterable<StrandsStreamEvent>;

const TEXT_DELTA = 'textDelta';
const TOOL_USE_START = 'toolUseStart';
const MODEL_CONTENT_BLOCK_DELTA = 'modelContentBlockDeltaEvent';
const MODEL_CONTENT_BLOCK_START = 'modelContentBlockStartEvent';

/**
 * Translate one Strands event into zero or more wire event bodies. Kept
 * pure and export-visible so it can be unit-tested without a live agent.
 */
export function toStreamEventBodies(event: StrandsStreamEvent): AgentStreamEventBody[] {
  // Unwrap the agent-level envelope to reach the raw model stream event.
  const inner =
    event.type === MODEL_STREAM_UPDATE && event.event ? event.event : event;

  if (inner.type === MODEL_CONTENT_BLOCK_DELTA && inner.delta?.type === TEXT_DELTA) {
    const text = inner.delta.text ?? '';
    return text.length > 0 ? [{ data: text }] : [];
  }

  if (inner.type === MODEL_CONTENT_BLOCK_START && inner.start?.type === TOOL_USE_START) {
    const name = inner.start.name;
    if (name) {
      return [{ current_tool_use: { name, tool_use_id: inner.start.toolUseId } }];
    }
  }

  return [];
}

/** Options for {@link streamTurn}. */
export interface StreamTurnOptions {
  /** Conversation/session id, echoed in the terminal `complete` message. */
  sessionId: string;
  /** Callback that pushes each wire-protocol message to the client. */
  send: SendMessage;
}

/**
 * Runs one turn: streams the agent's response, pushing wire messages to the
 * client as tokens arrive, and returns the fully accumulated assistant text.
 *
 * Emits, in order:
 *   { type: "stream_event", event: { init_event_loop: true } }
 *   { type: "stream_event", event: { data } }              (repeated)
 *   { type: "stream_event", event: { current_tool_use } }  (as tools run)
 *   { type: "stream_event", event: { complete: true } }
 *   { type: "complete", session_id }
 *
 * Any error thrown by the underlying stream propagates to the caller, which
 * owns error framing (the host sends a { type: "error" } message).
 */
export async function streamTurn(
  stream: StrandsStream,
  { sessionId, send }: StreamTurnOptions,
): Promise<string> {
  await send({ type: 'stream_event', event: { init_event_loop: true } });

  let fullText = '';
  for await (const event of stream) {
    for (const body of toStreamEventBodies(event)) {
      if (body.data) fullText += body.data;
      await send({ type: 'stream_event', event: body });
    }
  }

  await send({ type: 'stream_event', event: { complete: true } });
  await send({ type: 'complete', session_id: sessionId });

  return fullText;
}
