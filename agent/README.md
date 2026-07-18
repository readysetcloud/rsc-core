# @readysetcloud/agent

Portable, framework-agnostic Node agent core for Ready, Set, Cloud: a
[Strands-TS](https://github.com/strands-agents) assistant with DynamoDB-backed
conversation snapshots and pluggable cross-session memory.

The package knows nothing about WebSockets, AgentCore, HTTP, or any app. It
produces a configured Strands `Agent`, runs a turn through a wire-protocol
streamer, and persists conversation snapshots for multi-turn continuity. Cross-
session memory is transport-specific, so the host supplies a Strands
`memoryManager` (in rsc-core, the runtime backs it with AgentCore Memory). A host
(an AgentCore Runtime artifact, a Lambda, a test) supplies the transport,
identity, and memory backend.

## Install

```bash
npm install @readysetcloud/agent
```

Requires Node 22+. All dependencies are pure-JS AWS SDK v3 clients plus the
Strands SDK and `zod`.

## API — `import { ... } from '@readysetcloud/agent'`

| Export | Purpose |
| --- | --- |
| `createAssistant({ sessionId, modelId?, systemPrompt?, temperature?, maxTokens?, tools?, memoryManager?, storage? })` | Builds a Strands `Agent` with a DynamoDB session manager (snapshots) and, when a `memoryManager` is passed, cross-session memory (recall + auto-injection + extraction). |
| `handleUserMessage(agent, { request, sessionId, send })` | Runs one turn: streams wire messages via `send`, flushes the memory manager so the turn is durably captured, returns the assistant text. |
| `createSession({ userId, systemPrompt?, modelId?, temperature?, maxTokens?, title?, tools?, mcpServers?, sessionId?, tableName? })`, `getSessionConfig(sessionId, tableName?)` | Per-session config so a generic host loads prompt/model/tools by `sessionId` at connect (no redeploy to change behavior). `createSession` sets the owner; the host enforces it. `tools` selects first-party tools by name; `mcpServers` attaches external MCP tool sources (see [MCP servers](#mcp-servers-external-tools)). Also on the `./memory` subpath. |
| `runAgentTask({ taskId, principal, request, buildAgent, … })` | Runs one autonomous (non-chat) task to completion in the host: warm-cache → idempotent claim → `buildAgent` → run → record row → emit result event. See [Autonomous tasks](#autonomous-tasks-non-chat-agents). |
| `handleTask(agent, { request })` | Buffered sibling of `handleUserMessage`: invokes the agent, flushes memory, returns the final text — no streaming. The single-turn primitive `runAgentTask` wraps. |
| `runAgent({ input, systemPrompt?, modelId?, tools?, outputSchema?, maxIterations?, invocationState?, … })` | Stateless one-shot server-side invocation — build-and-discard, no session/snapshot/table. Enforces a Zod `outputSchema` (returns the validated object), bounds tool loops with `maxIterations`, and injects trusted per-call context via `invocationState`. See [Server-side one-shot runs](#server-side-one-shot-runs-runagent). |
| `tool({ name, description, inputSchema, callback })` | Re-export of the Strands tool-definition helper, so hosts define tools without importing the SDK directly. Handlers read trusted context from `context.invocationState`. |
| `createTask` / `startTask` / `finishTask` / `getTask`, `requestAgentTask` / `emitTaskCompleted`, `TaskResultCache` | The autonomous-task data plane: durable task rows (idempotent lifecycle), the EventBridge trigger/result contract, and an in-memory result cache. All Strands-free (on `./memory`). |
| `streamTurn(stream, { sessionId, send })`, `toStreamEventBodies(event)` | Streaming primitives / the SDK→wire normalizer (the one SDK coupling point). |
| `DynamoSnapshotStorage` | Implements Strands' `SnapshotStorage` port against the single table. |
| `DEFAULT_MODEL_ID`, `DEFAULT_REGION`, `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_MAX_TOKENS`, `DEFAULT_TEMPERATURE` | Config constants (env-overridable). |
| wire types — `ServerMessage`, `ClientMessage`, `AgentStreamEventBody`, `SendMessage` | The streaming contract shared with the UI client. |

Cross-session memory is **not** built into `createAssistant`. Pass a Strands
`memoryManager` — the host owns the backend. In rsc-core the AgentCore Runtime
builds it from AgentCore Memory (`bedrock-agentcore/experimental/memory/strands`);
see `agent-runtime/src/index.ts`. This keeps the package transport-agnostic.

### `@readysetcloud/agent/memory` subpath

```ts
import { DynamoSnapshotStorage, createSession } from '@readysetcloud/agent/memory';
```

Re-exports only the modules that pull in **no** Strands SDK (snapshot storage +
session config) — import it from Lambdas so they don't bundle the agent runtime.
Importing the package root would transitively load Strands and its optional
integrations.

## Usage

```ts
import { createAssistant, handleUserMessage } from '@readysetcloud/agent';

// Once per session/connection. Pass a memoryManager (built by the host from the
// verified user) to enable cross-session memory; omit it for a stateless one.
const agent = createAssistant({ sessionId, memoryManager });

// Per turn — `send` pushes wire messages to the client (e.g. over a WebSocket):
const answer = await handleUserMessage(agent, {
  request: userText,
  sessionId,
  send: (msg) => socket.send(JSON.stringify(msg)),
});
```

**Identity is the verified caller.** The host builds the `memoryManager` scoped
to a trusted user id (e.g. a Cognito `sub` from a verified inbound JWT), never a
client-supplied value — so memory can't leak across users.

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

## Autonomous tasks (non-chat agents)

Beyond the streaming chat surface, the package runs **autonomous tasks**: a
one-shot "do something" invocation of the agent that goes through the same secure
runtime with no browser holding a socket. Chat needs a socket; a task needs a
**trigger**, an **identity**, and a **result sink** — those are the three pieces
here.

**One envelope.** The same `AgentTaskResult` shape — `{ taskId, status, output?,
error? }` — is what an API returns, what the task row stores, and what the result
event carries. `status` is `PENDING | RUNNING | COMPLETED | FAILED`.

**Identity is a `Principal`** — `{ type: 'user' | 'system', id }`. A `user` task
(id = verified Cognito `sub`) reuses session ownership and MCP `authHeader`
propagation unchanged. A `system` task (id = a service, e.g. `booked`) is for
ecosystem work with no owning user. Asserting a `system` principal is privileged — over the
account-internal event bus a first-party emitter is already trusted to assert it;
over a public host API it must be gated (see [Gating a system
principal](#gating-a-system-principal-a-host-responsibility)). When a human
launches a system task, the host records their id as `createdBy` (distinct from
`principal`) so they can still read it back even though the run acts as the
system.

### Triggering — event (decoupled) or a host API (sync-capable)

`requestAgentTask` emits a `"Run Agent Task"` event and returns the `taskId`
immediately — the fire-and-forget path, mirroring `requestSession`. A first-party
backend needs only `events:PutEvents`:

```ts
import { requestAgentTask } from '@readysetcloud/agent/memory';

const { taskId } = await requestAgentTask({
  principal: { type: 'system', id: 'booked' },   // or { type: 'user', id: sub }
  request: 'Summarize this week’s new blog comments',
  // optional: sessionId, systemPrompt/modelId/…, tools, mcpServers
});
```

A host can also expose a synchronous API (in rsc-core, `POST /agent/tasks` with a
`wait` flag) that triggers the run and waits briefly for the result, falling back
to the event when the run outlives the request timeout. See the [rsc-core
README](../README.md#agent-service--streaming-ai-chat).

### Running — `runAgentTask` (the host runs the agent)

The task **runs wherever the host runs it** — the portable core has no runtime of
its own. In rsc-core that's a Lambda consuming the `"Run Agent Task"` event; it
could equally be any compute with the package installed. `runAgentTask` owns the
whole lifecycle; you supply a `buildAgent` factory (called only *after* the claim
succeeds, so a duplicate never builds or connects anything):

```ts
import { runAgentTask, createAssistant, getSessionConfig, TaskResultCache } from '@readysetcloud/agent';

const cache = new TaskResultCache();   // module scope — reused across warm invocations

const result = await runAgentTask({
  taskId, principal, request, sessionId,
  cache,
  buildAgent: async () => {
    const config = sessionId ? await getSessionConfig(sessionId) : null;
    if (config && config.userId !== principal.id) throw new Error('not your session');
    const agent = createAssistant({ sessionId: sessionId ?? `task-${taskId}`, /* prompt/model/tools/mcp */ });
    return { agent, cleanup: async () => {/* disconnect MCP clients */} };
  },
});
```

`runAgentTask` = warm-cache check → **exclusive claim** → `buildAgent` →
`handleTask` → `finishTask` → `emitTaskCompleted`, returning the result envelope.
The claim (`startTask`) is a conditional write (only from absent/PENDING/FAILED),
so DynamoDB serializes N duplicate deliveries and exactly one wins — the
correctness guard against re-running the agent or its tools. The in-memory
`TaskResultCache` is only a warm-instance fast path in front of it (a miss is
always correct — never "task not found"). The lower-level primitives
(`startTask` / `finishTask` / `handleTask` / `emitTaskCompleted`) are exported too
if you need to compose the lifecycle yourself.

> **Memory:** `runAgentTask` runs whatever agent `buildAgent` returns. Pass a
> `memoryManager` to `createAssistant` for cross-session recall, or omit it for a
> stateless run — the host's choice. rsc-core's task Lambda runs memory-light
> (snapshots only) to avoid pulling the AgentCore Memory dependency into the
> function; the chat runtime is the one that wires full cross-session memory.

### Result — event + row (never a cross-boundary table read)

The host emits `"Agent Task Completed"` on **every** finished run, so async
consumers are uniform regardless of whether a synchronous caller was still
waiting. The task row is the host's own bookkeeping and the target of a
`GET /agent/tasks/{id}`; a result crosses a stack boundary as the **event**, not
a table read.

### Gating a system principal — a host responsibility

Like the MCP `mcpServers` allowlist, **who may assert a `system` principal is a
host decision, not the package's** — `requestAgentTask`/`createTask` take a
principal at face value, because their trusted callers (a first-party backend on
the account-internal bus) are already entitled to one. The gate matters only when
a host exposes task creation to a *public* caller.

In rsc-core, [`functions/create-task.mjs`](../functions/create-task.mjs) does
this for `POST /agent/tasks`: a request may include `system: '<id>'`, and the
Lambda mints a `system` principal only if the verified caller is allowlisted for
that id in `SYSTEM_TASK_PRINCIPALS` (comma-separated `sub:systemId` grants; a
`sub:*` grant allows any id; empty rejects all — opt in explicitly). The human
launcher is recorded as `createdBy` so they can still `GET` the task. A public
caller with no grant only ever gets a `user` task scoped to themselves. Add a
grant before a public caller can run as a system.

### `tableName` — library mode

Every data-plane call (`createTask`/`getTask`/…, `createSession`/
`getSessionConfig`, `new DynamoSnapshotStorage(tableName)`, and `createAssistant({
tableName })`) takes an optional `tableName`, defaulting to the `TABLE_NAME` env.
Pass it to run the agent in **your own** stack against **your own** table
(library mode) instead of through a shared host. Note the boundary: a library-mode
run does not go through the shared runtime's guarantees (Bedrock grant, MCP
allowlist, memory isolation) — your stack owns them.

## Server-side one-shot runs (`runAgent`)

`runAgent` is the bare primitive: build a Strands `Agent`, run **one** turn to
completion, return the answer. No session manager, no snapshots, no DynamoDB —
nothing persists, so it needs no table and leaves no trace. Where
`handleUserMessage` streams a chat turn to a browser and `runAgentTask` wraps a
run in a durable, idempotent task record, `runAgent` is what a **server-side
orchestrator** (e.g. a Lambda fanning one input across several independent
analyses) reaches for when each analysis is an isolated call.

```ts
import { runAgent } from '@readysetcloud/agent';
import { z } from 'zod';

// One-shot STRUCTURED analysis — no prose parsing, get a validated object.
const grammar = await runAgent({
  input: draft,
  modelId: 'us.anthropic.claude-lite-...',   // pin a model per lens
  systemPrompt: 'You are a grammar & spelling reviewer.',
  outputSchema: z.object({
    suggestions: z.array(z.object({ span: z.string(), fix: z.string() })),
  }),
});
grammar.output.suggestions;   // typed, schema-validated — not a string
```

- **Structured output enforcement.** Pass `outputSchema` (a Zod schema) and the
  SDK forces the model to emit against it; `output` is the validated object and
  `structured` is `true`. If the model can't produce a conforming result even
  after being forced, the SDK throws — a resolved call is a schema-valid one.
  Omit the schema and `output` is the response text.
- **Bounded tool loops.** Pass `tools` (first-party `tool()`s, an `McpClient`,
  or a sub-agent) for a tool-using analysis — a fact lens over web
  search/fetch — and cap the loop with `maxIterations` (mapped to the SDK's
  per-invocation `limits.turns`) so it can't run away.
- **Per-lens model selection.** `modelId` pins a Pro- vs Lite-tier model for
  this call; different lenses pick different models.
- **Trusted context injection.** `invocationState` is threaded to every tool's
  execution context (`context.invocationState`) and returned on the result. It
  is the injection point for values the model **must not supply or forge** — a
  `tenantId`, the caller's verified `sub`. Because it is not a tool input
  parameter, the model never sees or sets it; trusted code sets it, handlers
  read it:

  ```ts
  import { runAgent, tool } from '@readysetcloud/agent';
  import { z } from 'zod';

  const searchBlog = tool({
    name: 'search_blog',
    description: "Search the tenant's own posts",
    inputSchema: z.object({ query: z.string() }),   // model supplies only this
    callback: async ({ query }, context) => {
      const tenantId = context?.invocationState.tenantId as string;  // trusted, not model-supplied
      return searchWithinTenant(tenantId, query);
    },
  });

  const facts = await runAgent({
    input: draft,
    systemPrompt: 'Fact-check claims using the blog search tool.',
    tools: [searchBlog],
    maxIterations: 6,
    invocationState: { tenantId, sub },   // injected by trusted code
  });
  ```

**Multi-lens engine sketch.** Each lens is an independent `runAgent` call; the
orchestrator fans them out and (optionally) synthesizes:

```ts
const [grammar, llm, facts] = await Promise.all([
  runAgent({ input, systemPrompt: GRAMMAR, outputSchema: GrammarSchema }),
  runAgent({ input, systemPrompt: LLM_DETECT, outputSchema: DetectSchema }),
  runAgent({ input, systemPrompt: FACTS, tools: [searchBlog], maxIterations: 6,
             invocationState: { tenantId, sub } }),
]);

const summary = await runAgent({
  input: JSON.stringify({ grammar: grammar.output, llm: llm.output, facts: facts.output }),
  systemPrompt: SUMMARY,
  outputSchema: SummarySchema,
});
```

To attach an **MCP** web-search/fetch gateway to a lens instead of first-party
tools, connect it and pass the client in `tools` — see [MCP servers](#mcp-servers-external-tools)
for how the runtime resolves specs and forwards verified identity via
`authHeader`. For a **durable** orchestrator (idempotent under at-least-once
delivery), run the outer call as a task (`runAgentTask`) and let its lenses call
`runAgent`. Streaming a run's tokens is not covered here — `runAgent` buffers
the final answer.

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
| `TABLE_NAME` | Yes | — | Snapshot storage + session config (DynamoDB). |
| `BEDROCK_MODEL_ID` | No | `us.amazon.nova-lite-v1:0` | Chat model. |
| `BEDROCK_REGION` / `AWS_REGION` | No | `us-east-1` | Bedrock region. |
| `BEDROCK_MAX_TOKENS` | No | `4096` | Model max tokens. |
| `BEDROCK_TEMPERATURE` | No | `0.7` | Model temperature. |

Cross-session memory has **no** env here — the host owns the backend. In
rsc-core the runtime reads `AGENT_MEMORY_ID` (the AgentCore Memory resource) to
build the `memoryManager`; see `agent-runtime`.

### Single-table keys

The agent core expects a single DynamoDB table with these keys (match them, or
adapt `DynamoSnapshotStorage`):

- **Snapshots:** `pk=SESSION#{sessionId}`, `sk=SNAPSHOT#{scope}#{scopeId}#{id}` / `LATEST#…` / `MANIFEST#…`.
- **Session config:** `pk=SESSION#{sessionId}`, `sk=CONFIG` (owner + prompt/model/tools).
- **Task records:** `pk=TASK#{taskId}`, `sk=STATUS` (autonomous-run status/result, short TTL).

Every data-plane function takes an optional `tableName` (defaulting to
`TABLE_NAME`) so the package can be pointed at any table — see [`tableName` —
library mode](#tablename--library-mode).

Cross-session semantic memory is **not** in this table — it lives in AgentCore
Memory (managed), written per turn via `createEvent` and retrieved by the
`memoryManager`.

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
