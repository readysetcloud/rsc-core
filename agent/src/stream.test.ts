import { describe, it, expect, vi } from 'vitest';
import { toStreamEventBodies, streamTurn, type StrandsStreamEvent } from './stream.js';
import type { ServerMessage } from './protocol.js';

// Helpers building the real agent-level envelopes agent.stream() yields.
const textEvent = (text: string): StrandsStreamEvent => ({
  type: 'modelStreamUpdateEvent',
  event: { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text } },
});
const toolEvent = (name: string, toolUseId: string): StrandsStreamEvent => ({
  type: 'modelStreamUpdateEvent',
  event: {
    type: 'modelContentBlockStartEvent',
    start: { type: 'toolUseStart', name, toolUseId },
  },
});

describe('toStreamEventBodies', () => {
  it('maps a wrapped text delta to a data body', () => {
    expect(toStreamEventBodies(textEvent('hello'))).toEqual([{ data: 'hello' }]);
  });

  it('also handles an unwrapped model event defensively', () => {
    const ev: StrandsStreamEvent = {
      type: 'modelContentBlockDeltaEvent',
      delta: { type: 'textDelta', text: 'hi' },
    };
    expect(toStreamEventBodies(ev)).toEqual([{ data: 'hi' }]);
  });

  it('drops empty text deltas', () => {
    expect(toStreamEventBodies(textEvent(''))).toEqual([]);
  });

  it('maps a tool-use start to a current_tool_use body', () => {
    expect(toStreamEventBodies(toolEvent('recall_memory', 'tu-1'))).toEqual([
      { current_tool_use: { name: 'recall_memory', tool_use_id: 'tu-1' } },
    ]);
  });

  it('ignores unrelated events', () => {
    expect(toStreamEventBodies({ type: 'agentResultEvent' })).toEqual([]);
    expect(
      toStreamEventBodies({ type: 'modelStreamUpdateEvent', event: { type: 'modelMetadataEvent' } }),
    ).toEqual([]);
  });
});

describe('streamTurn', () => {
  async function* fakeStream(events: StrandsStreamEvent[]): AsyncGenerator<StrandsStreamEvent> {
    for (const e of events) yield e;
  }

  it('emits init, tokens, complete-event, and complete message in order and returns full text', async () => {
    const sent: ServerMessage[] = [];
    const send = vi.fn((m: ServerMessage) => {
      sent.push(m);
    });

    const events: StrandsStreamEvent[] = [
      textEvent('Hel'),
      toolEvent('recall_memory', 'tu-9'),
      textEvent('lo'),
    ];

    const text = await streamTurn(fakeStream(events), { sessionId: 's-1', send });

    expect(text).toBe('Hello');
    expect(sent).toEqual([
      { type: 'stream_event', event: { init_event_loop: true } },
      { type: 'stream_event', event: { data: 'Hel' } },
      { type: 'stream_event', event: { current_tool_use: { name: 'recall_memory', tool_use_id: 'tu-9' } } },
      { type: 'stream_event', event: { data: 'lo' } },
      { type: 'stream_event', event: { complete: true } },
      { type: 'complete', session_id: 's-1' },
    ]);
  });
});
