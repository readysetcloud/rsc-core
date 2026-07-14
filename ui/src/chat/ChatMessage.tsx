import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import type { ChatMessage as ChatMessageData } from './useAgentChat';

// A single chat bubble. Presentational only — styled with the token utility
// classes shipped by the @readysetcloud/ui tailwind preset so it inherits the
// host app's theme (light/dark) automatically.

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
      {children}
    </ReactMarkdown>
  );
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.sender === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-primary-600 text-white'
            : message.error
              ? 'bg-error-100 text-error-700'
              : 'card text-foreground',
        ].join(' ')}
      >
        {message.thinking && (
          <details className="mb-2 text-sm text-muted-foreground">
            <summary className="cursor-pointer select-none">Thinking</summary>
            <div className="prose prose-sm mt-1 max-w-none">
              <Markdown>{message.thinking}</Markdown>
            </div>
          </details>
        )}
        <div className="prose prose-sm max-w-none">
          <Markdown>{message.text}</Markdown>
        </div>
        <div className="mt-1 text-right text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
