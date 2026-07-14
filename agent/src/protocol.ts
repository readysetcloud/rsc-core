// The wire protocol spoken over the WebSocket between the agent and the
// browser. This is the single source of truth for the streaming contract;
// the UI client mirrors these shapes.
//
// The shapes are preserved verbatim from the original Python agent so the
// existing frontend keeps working unchanged:
//
//   { type: "stream_event", event: { data: "..." } }                        // text token
//   { type: "stream_event", event: { current_tool_use: { name, tool_use_id } } }
//   { type: "stream_event", event: { init_event_loop: true } }
//   { type: "stream_event", event: { complete: true } }
//   { type: "complete", session_id: "..." }                                  // end of a turn
//   { type: "error", error: "...", message?: "..." }

/** A single agent-lifecycle event, nested under a `stream_event` envelope. */
export interface AgentStreamEventBody {
  /** A chunk of assistant-visible text (a token or token group). */
  data?: string;
  /** Emitted when the agent starts using a tool. */
  current_tool_use?: {
    name: string;
    tool_use_id?: string;
  };
  /** Emitted once when the agent's event loop initializes. */
  init_event_loop?: boolean;
  /** Emitted when the agent finishes producing its response. */
  complete?: boolean;
}

/**
 * A message the agent sends to the browser: a streamed lifecycle event, the
 * end-of-turn marker, or an error.
 */
export type ServerMessage =
  | { type: 'stream_event'; event: AgentStreamEventBody }
  | { type: 'complete'; session_id: string }
  | { type: 'error'; error: string; message?: string };

/** The message the browser sends to request a turn. */
export interface ClientMessage {
  request: string;
  session_id: string;
  /** Optional; the agent prefers the verified user id from connection headers. */
  user_id?: string;
}

/** Callback the host (AgentCore WebSocket handler) uses to push a message to the client. */
export type SendMessage = (message: ServerMessage) => void | Promise<void>;
