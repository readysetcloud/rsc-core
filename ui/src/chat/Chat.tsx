import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useAgentChat, type UseAgentChatOptions } from './useAgentChat';
import { ChatMessage } from './ChatMessage';

// A drop-in chat surface built on useAgentChat. Apps pass the same options the
// hook takes (sessionId, userId, getConnectionUrl). Styling uses the
// @readysetcloud/ui tailwind-preset token classes.

export type ChatProps = UseAgentChatOptions & {
  /** Optional heading shown above the transcript. */
  title?: string;
  /** Optional message sent automatically once connected (e.g. from a landing page). */
  initialQuery?: string;
};

const STATUS_LABEL: Record<string, string> = {
  connected: '🟢 Connected',
  connecting: '🟡 Connecting…',
  disconnected: '🔴 Disconnected',
};

export function Chat({ title = 'Assistant', initialQuery, ...options }: ChatProps) {
  const { messages, streamingText, thinkingText, currentTool, isLoading, connectionStatus, sendMessage } =
    useAgentChat(options);

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialSentRef = useRef(false);

  // Auto-send an initial query once connected.
  useEffect(() => {
    if (initialQuery && !initialSentRef.current && connectionStatus === 'connected' && !isLoading) {
      initialSentRef.current = true;
      sendMessage(initialQuery);
    }
  }, [initialQuery, connectionStatus, isLoading, sendMessage]);

  // Auto-scroll on new content.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, thinkingText]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const disabled = isLoading || connectionStatus !== 'connected';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="text-sm text-muted-foreground">{STATUS_LABEL[connectionStatus]}</span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {(streamingText || thinkingText) && (
          <div className="flex justify-start">
            <div className="card max-w-[80%] rounded-lg px-4 py-2 text-foreground">
              {thinkingText && (
                <div className="mb-2 text-sm text-muted-foreground">
                  <div className="font-medium">Thinking…</div>
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                      {thinkingText}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
              {currentTool && !streamingText && (
                <div className="text-sm text-muted-foreground">
                  🔧 Using <strong>{currentTool}</strong>
                </div>
              )}
              {streamingText && (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading && !streamingText && !thinkingText && (
          <div className="text-sm text-muted-foreground">Thinking…</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border p-4">
        <textarea
          className="input flex-1 resize-none"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connectionStatus === 'connected' ? 'Type your message…' : 'Connecting…'}
          rows={2}
          disabled={disabled}
        />
        <button className="btn-primary" onClick={handleSend} disabled={disabled || !inputText.trim()}>
          {isLoading ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
