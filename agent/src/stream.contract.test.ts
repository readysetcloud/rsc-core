import { describe, it, expect } from 'vitest';
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
} from '@strands-agents/sdk';
import type {
  ModelStreamEvent,
  ModelStreamUpdateEvent,
  TextDelta,
  ToolUseStart,
} from '@strands-agents/sdk';
import { toStreamEventBodies, type StrandsStreamEvent } from './stream.js';

// Contract test pinning the stream normalizer to the REAL @strands-agents/sdk
// event shapes (retires the "stream event shape" migration risk). Unlike
// stream.test.ts, which uses hand-written structural stubs, this file:
//
//   1. Constructs real SDK event class INSTANCES — if a bump renames a
//      discriminant or moves a field, construction/assertions break at runtime.
//   2. Binds the fixtures to real SDK TYPES via `satisfies` — a type-level
//      shape change fails `npm run typecheck` (which includes test files).
//
// So an SDK upgrade that changes the event contract fails CI loudly instead of
// silently breaking streaming. If it fails, fix src/stream.ts — the single
// place the streaming contract is coupled to the SDK.

// Real class instances (values from the SDK), with their data bound to the SDK
// delta/start types.
const textDeltaEvent = new ModelContentBlockDeltaEvent({
  type: 'modelContentBlockDeltaEvent',
  delta: { type: 'textDelta', text: 'hello' } satisfies TextDelta,
});

const toolStartEvent = new ModelContentBlockStartEvent({
  type: 'modelContentBlockStartEvent',
  start: {
    type: 'toolUseStart',
    name: 'recall_memory',
    toolUseId: 'tu-1',
  } satisfies ToolUseStart,
});

// The agent-level envelope agent.stream() actually yields. Typed against the
// real wrapper's { type, event } surface (the only fields the normalizer reads).
const envelope = {
  type: 'modelStreamUpdateEvent',
  event: textDeltaEvent,
} satisfies Pick<ModelStreamUpdateEvent, 'type' | 'event'>;

// Assert our normalizer's discriminant constants still match the real SDK
// discriminants (typed as ModelStreamEvent members).
const _sdkDiscriminants: ModelStreamEvent['type'][] = [
  'modelContentBlockDeltaEvent',
  'modelContentBlockStartEvent',
];

describe('stream contract (real @strands-agents/sdk shapes)', () => {
  it('SDK class instances carry the discriminants stream.ts keys on', () => {
    expect(textDeltaEvent.type).toBe('modelContentBlockDeltaEvent');
    expect(toolStartEvent.type).toBe('modelContentBlockStartEvent');
    expect(_sdkDiscriminants).toContain(textDeltaEvent.type);
  });

  it('maps a real text delta event', () => {
    expect(toStreamEventBodies(textDeltaEvent as unknown as StrandsStreamEvent)).toEqual([
      { data: 'hello' },
    ]);
  });

  it('maps a real tool-use start event', () => {
    expect(toStreamEventBodies(toolStartEvent as unknown as StrandsStreamEvent)).toEqual([
      { current_tool_use: { name: 'recall_memory', tool_use_id: 'tu-1' } },
    ]);
  });

  it('unwraps a real modelStreamUpdateEvent envelope', () => {
    expect(toStreamEventBodies(envelope as unknown as StrandsStreamEvent)).toEqual([
      { data: 'hello' },
    ]);
  });
});
