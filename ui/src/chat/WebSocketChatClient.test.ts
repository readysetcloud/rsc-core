import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketChatClient } from './WebSocketChatClient';
import type { ServerMessage } from './protocol';

// Minimal controllable fake WebSocket (jsdom has none).
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error assigning a test double to the global
  globalThis.WebSocket = FakeWebSocket;
});

describe('WebSocketChatClient', () => {
  it('connects using the injected presigned URL and resolves on open', async () => {
    const getConnectionUrl = vi.fn().mockResolvedValue('wss://example/ws?sig=abc');
    const client = new WebSocketChatClient({ getConnectionUrl });

    const connecting = client.connect('sess-1');
    // The fake socket exists synchronously after the URL resolves.
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;

    expect(getConnectionUrl).toHaveBeenCalledWith('sess-1');
    expect(socket.url).toBe('wss://example/ws?sig=abc');
    expect(client.isConnected()).toBe(true);
  });

  it('sends a well-formed query frame', async () => {
    const client = new WebSocketChatClient({
      getConnectionUrl: async () => 'wss://example/ws',
    });
    const connecting = client.connect();
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;

    client.sendQuery('hello', 'sess-9', 'user-1');
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      request: 'hello',
      session_id: 'sess-9',
      user_id: 'user-1',
    });
  });

  it('dispatches server messages to type-specific listeners', async () => {
    const client = new WebSocketChatClient({
      getConnectionUrl: async () => 'wss://example/ws',
    });
    const connecting = client.connect();
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;

    const events: ServerMessage[] = [];
    client.on('stream_event', (m) => events.push(m));
    socket.receive({ type: 'stream_event', event: { data: 'hi' } });

    expect(events).toEqual([{ type: 'stream_event', event: { data: 'hi' } }]);
  });
});
