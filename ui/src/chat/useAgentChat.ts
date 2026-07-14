import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketChatClient } from './WebSocketChatClient';
import type { ConnectionStatus, ServerMessage } from './protocol';

// useAgentChat owns the connection lifecycle (reconnect/backoff), the
// transport, and the streaming state. An app supplies `getConnectionUrl`
// (which calls the backend presigned-URL endpoint with its auth) and a
// `sessionId`, and gets back everything needed to render a streaming chat.

export interface ChatMessage {
  id: string;
  text: string;
  thinking?: string;
  sender: 'user' | 'agent';
  timestamp: Date;
  error?: boolean;
}

export interface UseAgentChatOptions {
  /** Current conversation id; sent with each message. */
  sessionId: string;
  /** Verified user id; forwarded to the agent for memory scoping. */
  userId?: string;
  /** Returns a presigned wss:// URL (the app calls its backend with auth here). */
  getConnectionUrl: (sessionId?: string) => Promise<string>;
  /** Connect on mount (default true). */
  autoConnect?: boolean;
}

export interface UseAgentChat {
  messages: ChatMessage[];
  streamingText: string;
  thinkingText: string;
  currentTool: string | null;
  isLoading: boolean;
  connectionStatus: ConnectionStatus;
  sendMessage: (text: string) => void;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

export function useAgentChat(options: UseAgentChatOptions): UseAgentChat {
  const { sessionId, userId, getConnectionUrl, autoConnect = true } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Refs so the connection effects don't re-run when session/user/url change,
  // and so streaming accumulation survives rapid re-renders.
  const clientRef = useRef<WebSocketChatClient | null>(null);
  const sessionIdRef = useRef(sessionId);
  const userIdRef = useRef(userId);
  const getUrlRef = useRef(getConnectionUrl);
  const streamingRef = useRef('');
  const thinkingRef = useRef('');
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  sessionIdRef.current = sessionId;
  userIdRef.current = userId;
  getUrlRef.current = getConnectionUrl;

  if (clientRef.current === null) {
    clientRef.current = new WebSocketChatClient({
      getConnectionUrl: (sid) => getUrlRef.current(sid),
    });
  }

  const finishTurn = useCallback(() => {
    const text = streamingRef.current;
    const thinking = thinkingRef.current;
    if (text || thinking) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-agent`,
          text,
          ...(thinking ? { thinking } : {}),
          sender: 'agent',
          timestamp: new Date(),
        },
      ]);
    }
    streamingRef.current = '';
    thinkingRef.current = '';
    setStreamingText('');
    setThinkingText('');
    setCurrentTool(null);
    setIsLoading(false);
  }, []);

  // Wire up message handlers once.
  useEffect(() => {
    const client = clientRef.current!;

    const onStreamEvent = (msg: ServerMessage) => {
      const event = msg.event;
      if (!event) return;

      // A tool starting moves any streamed text so far into the "thinking" pane.
      if (event.current_tool_use?.name) {
        setCurrentTool(event.current_tool_use.name);
        if (streamingRef.current) {
          thinkingRef.current += streamingRef.current;
          setThinkingText(thinkingRef.current);
          streamingRef.current = '';
          setStreamingText('');
        }
      }

      if (event.data) {
        streamingRef.current += event.data;
        setStreamingText(streamingRef.current);
      }
    };

    const onComplete = () => finishTurn();

    const onError = (msg: ServerMessage) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-error`,
          text: msg.message || msg.error || 'An error occurred',
          sender: 'agent',
          timestamp: new Date(),
          error: true,
        },
      ]);
      streamingRef.current = '';
      thinkingRef.current = '';
      setStreamingText('');
      setThinkingText('');
      setCurrentTool(null);
      setIsLoading(false);
    };

    const onClose = () => setConnectionStatus('disconnected');

    client.on('stream_event', onStreamEvent);
    client.on('complete', onComplete);
    client.on('error', onError);
    client.on('close', onClose);

    return () => {
      client.off('stream_event', onStreamEvent);
      client.off('complete', onComplete);
      client.off('error', onError);
      client.off('close', onClose);
    };
  }, [finishTurn]);

  const connect = useCallback(async () => {
    const client = clientRef.current!;
    try {
      setConnectionStatus('connecting');
      client.close(); // preserve listeners across reconnects
      await client.connect(sessionIdRef.current);
      setConnectionStatus('connected');
      reconnectAttemptRef.current = 0;
    } catch {
      setConnectionStatus('disconnected');
    }
  }, []);

  const connectWithBackoff = useCallback(() => {
    if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  // Connect on mount; full cleanup on unmount.
  useEffect(() => {
    if (autoConnect) connect();
    const client = clientRef.current!;
    return () => {
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      client.destroy();
    };
  }, [autoConnect, connect]);

  // Reconnect when the tab becomes visible or the network is restored.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !clientRef.current!.isConnected()) {
        connectWithBackoff();
      }
    };
    const handleOnline = () => {
      if (!clientRef.current!.isConnected()) connectWithBackoff();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [connectWithBackoff]);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading || connectionStatus !== 'connected') return;

    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, text: trimmed, sender: 'user', timestamp: new Date() },
    ]);
    setIsLoading(true);
    streamingRef.current = '';
    thinkingRef.current = '';
    setStreamingText('');
    setThinkingText('');

    clientRef.current!.sendQuery(trimmed, sessionIdRef.current, userIdRef.current);
  }, [isLoading, connectionStatus]);

  return {
    messages,
    streamingText,
    thinkingText,
    currentTool,
    isLoading,
    connectionStatus,
    sendMessage,
  };
}
