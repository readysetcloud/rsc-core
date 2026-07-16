// @readysetcloud/ui/chat — React chat surface for the AgentCore agent.
// Kept on its own subpath (like ./auth) so apps that don't render chat don't
// pull in react-markdown & friends.

export { Chat, type ChatProps } from './Chat';
export { ChatMessage } from './ChatMessage';
export {
  useAgentChat,
  type UseAgentChat,
  type UseAgentChatOptions,
  type ChatMessage as ChatMessageData,
} from './useAgentChat';
export {
  WebSocketChatClient,
  type WebSocketChatClientOptions,
  type ChatConnectionTarget,
} from './WebSocketChatClient';
export type {
  ServerMessage,
  AgentStreamEventBody,
  ConnectionStatus,
  ServerMessageListener,
} from './protocol';
