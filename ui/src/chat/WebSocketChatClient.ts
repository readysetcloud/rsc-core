import type { ServerMessage, ServerMessageListener } from './protocol';

// Framework-agnostic WebSocket client for the AgentCore chat stream. The
// caller injects a `getConnectionUrl` function that returns a presigned wss://
// URL — so the client imports no app-specific auth/api and stays reusable
// across apps.

export interface WebSocketChatClientOptions {
  /** Returns a presigned wss:// URL for the given session. */
  getConnectionUrl: (sessionId?: string) => Promise<string>;
}

type EventType = ServerMessage['type'] | 'open' | 'close';

export class WebSocketChatClient {
  private ws: WebSocket | null = null;
  private readonly getConnectionUrl: (sessionId?: string) => Promise<string>;
  private readonly listeners = new Map<EventType, Set<ServerMessageListener>>();
  private connected = false;

  constructor(options: WebSocketChatClientOptions) {
    this.getConnectionUrl = options.getConnectionUrl;
  }

  /** Opens a connection. Resolves once the socket is open. */
  async connect(sessionId?: string): Promise<void> {
    const url = await this.getConnectionUrl(sessionId);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.emit('open', { type: 'complete' });
        resolve();
      };

      ws.onmessage = (event) => {
        let data: ServerMessage;
        try {
          data = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (data.type) this.emit(data.type, data);
      };

      ws.onerror = () => {
        this.emit('error', { type: 'error', error: 'WebSocket connection error' });
        if (!this.connected) reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = (event) => {
        this.connected = false;
        if (event.code === 4401 || event.code === 1008) {
          this.emit('error', {
            type: 'error',
            error: 'Authentication failed - invalid or expired token',
          });
          reject(new Error('Authentication failed'));
          return;
        }
        this.emit('close', { type: 'complete' });
      };
    });
  }

  /** Sends a user request for the given session. */
  sendQuery(request: string, sessionId: string, userId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.emit('error', { type: 'error', error: 'WebSocket connection is not open' });
      return;
    }
    this.ws.send(JSON.stringify({ request, session_id: sessionId, user_id: userId }));
  }

  on(type: EventType, listener: ServerMessageListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  off(type: EventType, listener: ServerMessageListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: EventType, message: ServerMessage): void {
    this.listeners.get(type)?.forEach((listener) => listener(message));
  }

  /** Closes the socket but keeps listeners (used for reconnects). */
  close(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connected = false;
  }

  /** Closes the socket and clears listeners (used on unmount/logout). */
  destroy(): void {
    this.close();
    this.listeners.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.connected;
  }
}
