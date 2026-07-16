# @readysetcloud/agent

Portable, framework-agnostic Node agent core for Ready, Set, Cloud: a
[Strands-TS](https://github.com/strands-agents) assistant with DynamoDB-backed
conversation history and semantic vector memory.

The package knows nothing about WebSockets, AgentCore, HTTP, or any app. It
produces a configured Strands `Agent`, runs a turn through a wire-protocol
streamer, and persists the conversation for multi-turn continuity and semantic
recall. A host (an AgentCore Runtime artifact, a Lambda, a test) supplies the
transport and identity.

## Install

```bash
npm install @readysetcloud/agent
```

Requires Node 22+. All dependencies are pure-JS AWS SDK v3 clients plus the
Strands SDK and `zod`.

## API — `import { ... } from '@readysetcloud/agent'`

| Export | Purpose |
| --- | --- |
| `createAssistant({ sessionId, userId?, modelId?, systemPrompt?, temperature?, maxTokens?, tools?, storage? })` | Builds a Strands `Agent` with a DynamoDB session manager + `recall_memory` tool (added only when `userId` is set). |
| `handleUserMessage(agent, { request, sessionId, userId?, send })` | Runs one turn: streams wire messages via `send`, records the turn to DynamoDB, returns the assistant text. |
| `createSession({ userId, systemPrompt?, modelId?, temperature?, maxTokens?, title?, tools?, mcpServers?, sessionId? })`, `getSessionConfig(sessionId)` | Per-session config so a generic host loads prompt/model/tools by `sessionId` at connect (no redeploy to change behavior). `createSession` sets the owner; the host enforces it. `tools` selects first-party tools by name; `mcpServers` attaches external MCP tool sources (see [MCP servers](#mcp-servers-external-tools)). Also on the `./memory` subpath. |
| `streamTurn(stream, { sessionId, send })`, `toStreamEventBodies(event)` | Streaming primitives / the SDK→wire normalizer (the one SDK coupling point). |
| `DynamoSnapshotStorage` | Implements Strands' `SnapshotStorage` port against the single table. |
| `recordTurn`, `turnKey`, `TURN_ENTITY` | Conversation-turn rows. |
| `putMemoryTurns`, `recallMemory`, `deleteMemoryKeys`, `memoryVectorKey`, `embedText`, `EMBEDDING_DIMENSIONS` | Semantic-memory data plane (S3 Vectors + Titan). |
| `createRecallMemoryTool(userId)` | The `recall_memory` Strands tool (user-scoped). |
| `DEFAULT_MODEL_ID`, `DEFAULT_REGION`, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_MAX_TOKENS`, `DEFAULT_TEMPERATURE` | Config constants (env-overridable). |
| wire types — `ServerMessage`, `ClientMessage`, `AgentStreamEventBody`, `SendMessage` | The streaming contract shared with the UI client. |

### `@readysetcloud/agent/memory` subpath

```ts
import { putMemoryTurns, recordTurn } from '@readysetcloud/agent/memory';
```

Re-exports only the memory data plane and pulls in **no** Strands SDK — import
it from Lambdas (e.g. the DynamoDB-stream vectorizer) so they don't bundle the
agent runtime. Importing the package root would transitively load Strands and
its optional integrations.

## Usage

```ts
import { createAssistant, handleUserMessage } from '@readysetcloud/agent';

// Once per session/connection:
const agent = createAssistant({ sessionId, userId });

// Per turn — `send` pushes wire messages to the client (e.g. over a WebSocket):
const answer = await handleUserMessage(agent, {
  request: userText,
  sessionId,
  userId,          // verified caller id — never client-supplied
  send: (msg) => socket.send(JSON.stringify(msg)),
});
```

**Identity is the verified caller.** Pass `userId` from a trusted source (e.g. a
Cognito `sub` from a verified inbound JWT), never a client-supplied value.
`recall_memory` closes over that `userId`, so memory can't leak across users.

## Sessions (dynamic config)

A **session** carries its own configuration, so a single deployed host can serve
many differently-behaved agents without a redeploy — changing prompts or models
is a data operation.

```ts
import { createSession, getSessionConfig } from '@readysetcloud/agent';

// Create once (backend, or via an API that passes the verified userId):
const { sessionId } = await createSession({
  userId,                     // verified caller — becomes the session OWNER
  systemPrompt: 'You are a terse code reviewer.',
  modelId: 'us.anthropic.claude-sonnet-4-...',
  // temperature?, maxTokens?, title? — all optional; unset → package defaults
});

// The host loads it by id at connect and enforces ownership:
const config = await getSessionConfig(sessionId);
const agent = createAssistant({
  sessionId,
  userId,
  systemPrompt: config?.systemPrompt,
  modelId: config?.modelId,
  temperature: config?.temperature,
  maxTokens: config?.maxTokens,
});
```

The config row is `pk=SESSION#{sessionId}, sk=CONFIG` (same partition as that
session's snapshots) with `entity="SessionConfig"` and a TTL. **Safety:**
`createSession` records the owner `userId`; the host must compare
`config.userId` against the *verified* connecting user and refuse a mismatch, so
a leaked or guessed `sessionId` can't be used to resume another user's
conversation. A session with no config row → package defaults. `createSession`
is conditional on the session not already existing, so an owner can't be
overwritten. The generated `sessionId` is a UUID (satisfies AgentCore's runtime
session-id length requirement).

## MCP servers (external tools)

Beyond first-party `tools`, a session can attach external
[MCP](https://modelcontextprotocol.io) servers — the one place a session points
the runtime at an outbound URL. Each entry in `mcpServers` is an `McpServerSpec`
(a JSON-serializable subset of the Strands SDK's `McpServerConfig`), keyed by a
label:

```ts
await createSession({
  userId,                              // verified caller — the session owner
  mcpServers: {
    blog: {
      url: 'https://mcp.example.com/mcp',
      headers: { 'x-api-version': '2025-01' },   // user-supplied; `${VAR}` interpolated by the host
    },
  },
});
```

The host connects these at build time (`McpClient.loadServers`) and attaches
their tools alongside the first-party ones. `${VAR}` / `${env:VAR}` in string
fields is resolved by the SDK against the **host's** environment, so any secret
belongs in the runtime env — not in this row (which the user creates).

### SSRF allowlist — a host responsibility

Because `mcpServers` is an outbound URL under user control, the **host** must
allowlist which hosts a session may target before persisting the config — this
package does not. In rsc-core, `functions/create-session.mjs` rejects any
`mcpServers` whose url host is not in `MCP_ALLOWED_HOSTS` (comma-separated;
empty rejects all, so it's opt-in), threaded from the `McpAllowedHosts`
CloudFormation parameter. Add a host there before a session can reference it.

### `authHeader` — propagating verified identity to an MCP server

The SDK's env interpolation only reaches the *host's* env; it can't carry the
**connecting user's** verified identity to an MCP server. That matters for a
per-tenant tool (e.g. a blog search that must scope results to the asking user):
the server needs to know (a) the caller is the trusted runtime and (b) *which*
user is asking — and the config row, created by the user, is not a trusted place
for a per-user secret.

`McpServerSpec.authHeader` closes that gap:

```ts
mcpServers: {
  blog: {
    url: 'https://mcp.example.com/mcp',
    authHeader: {
      name: 'x-booked-auth',
      value: '<base64url(payload)>.<sig>',   // authority-minted, opaque to the runtime
    },
  },
}
```

- An **authority** (a trusted server-side session creator, *not* the browser)
  mints the token: it signs the identity/scope it wants the server to trust —
  e.g. `HMAC_SHA256(secret, `${tenantId}.${userId}.${sessionId}.${version}`)` —
  with a secret only the authority and the MCP server hold, and stores
  `{ name, value }` on the spec.
- The **runtime is a dumb courier**: it forwards `value` verbatim as the named
  outbound header on every request to that server and never interprets it.
  `authHeader` is applied *after* the user-supplied `headers`, so a session's own
  `headers` can't shadow it, and — unlike `headers` — it is passed through
  **literally** (no `${}` interpolation); mint opaque tokens with no `${` in
  them.
- The **MCP server** verifies the token with the shared secret, then trusts the
  claimed tenant/user.

**Threat model (state it plainly):** the HMAC proves *"the authority minted this
for user U"* — it does **not** cryptographically prove the presenter is this
runtime. That's acceptable here because the config row isn't user-reachable, the
host is allowlisted (above), and transport is TLS. Because the token is replayed
on every reconnect over the session's ~30-day TTL it is effectively long-lived;
bind it to the `sessionId` (so a leak can't move to another session) and include
a `version` the authority can bump to revoke outstanding tokens without rotating
the secret. A non-expiring, `sessionId`-bound, `version`-revocable token is a
defensible posture for a tool that only reads the owner's own content — document
the lifetime rather than implying a short-lived token.

## Wire protocol

`send` receives `ServerMessage`s spoken to the browser, unchanged from the
original Python agent:

```
{ type: "stream_event", event: { data } | { current_tool_use: { name, tool_use_id } } | { init_event_loop: true } | { complete: true } }
{ type: "complete", session_id }
{ type: "error", error, message? }
```

## Environment

Read at module scope; the same code runs in AgentCore, a Lambda, or a test.

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `TABLE_NAME` | Yes | — | Snapshot storage + turn rows (DynamoDB). |
| `VECTOR_BUCKET_NAME` | Yes (for memory) | — | S3 Vectors semantic memory. |
| `MEMORY_VECTOR_INDEX_NAME` | No | `conversation-memory` | S3 Vectors index name. |
| `EMBEDDING_MODEL_ID` | No | `amazon.titan-embed-text-v2:0` | Titan embeddings (must match the index dimension, 1024). |
| `BEDROCK_MODEL_ID` | No | `us.amazon.nova-lite-v1:0` | Chat model. |
| `BEDROCK_REGION` / `AWS_REGION` | No | `us-east-1` | Bedrock region. |
| `BEDROCK_MAX_TOKENS` | No | `4096` | Model max tokens. |
| `BEDROCK_TEMPERATURE` | No | `0.7` | Model temperature. |

### Single-table keys

The agent core expects a single DynamoDB table with these keys (match them, or
adapt `DynamoSnapshotStorage` / `turns.ts`):

- **Turn rows:** `pk=MEMORY#{userId}`, `sk=TURN#{sessionId}#{ts}#{role}`, `entity="Turn"`, `expiresAt` TTL.
- **Snapshots:** `pk=SESSION#{sessionId}`, `sk=SNAPSHOT#{scope}#{scopeId}#{id}` / `LATEST#…` / `MANIFEST#…`.
- A stream (`NEW_AND_OLD_IMAGES`) filtered to `entity=Turn` drives the vectorizer that populates S3 Vectors.

The S3 Vectors index is `conversation-memory`, **dim 1024, cosine, `text`
non-filterable**, with filter metadata `{ userId, sessionId, role }`.

## SDK contract guardrail

`src/stream.ts` is the single place coupled to `@strands-agents/sdk` (pinned
**exact** at `1.9.0`). `src/stream.contract.test.ts` constructs real SDK event
instances and type-binds fixtures via `satisfies`, so an SDK bump that changes
the event contract fails `npm test` (runtime) or `npm run typecheck`
(compile-time, includes test files). If it fails, fix `stream.ts`, then bump the
exact pin. Keep both the test and the typecheck step in CI.

## Develop

```bash
cd agent
npm install
npm test          # vitest — stream normalizer, contract, turns, snapshot storage
npm run typecheck # tsc over src + tests (guards the SDK contract)
npm run build     # tsc → dist/ (ESM + .d.ts), emits `.` and `./memory` entrypoints
```
