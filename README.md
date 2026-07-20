# Core resources and configuration

This is a foundational service of Ready, Set, Cloud and is used to maintain global configuration across all services. It also provides basic administrative functionality for site builds.

## Configuration

There are several deployment parameters that must be configured that will be saved into SSM parameters for global usage

* **GitHubOwner** - GitHub account owner of the repository containing the site source code
* **GitHubRepo** - GitHub repository name containing the site source code
* **UpdateGitHubSourceCode** - Boolean value indicating if the source code should update GitHub (used for prod/non-prod environments)
* **AdminEmail** - Email address to send notifications to
* **BucketName** - Name of the S3 bucket that holds static assets
* **AmplifyAppId** - Identifier of the Amplify app that hosts and builds the site (used to trigger automations)
* **DefaultCacheName** - Name of the [Momento cache](https://gomomento.com) used to cache data globally
* **SendgridApiKey** - API key used to send emails via SendGrid
* **GitHubPAT** - Personal Access Token used to access GitHub data
* **OpenAIApiKey** - API key used to query OpenAI
* **MomentoApiKey** - API key used to cache data and send events via Momento

## Deployment

This stack uses a SAM template. You must install and configure the SAM CLI for the following commands to work. This repository uses GitHub actions to deploy the assets to the cloud via the SAM CLI.

```bash
sam build --parallel --cached
sam deploy --guided
```

## Global Parameters

The configured deployment parameters above will be accessible by using the following:

* GitHubOwner - `{{resolve:ssm:/readysetcloud/github-owner}}`
* GitHubRepo - `{{resolve:ssm:/readysetcloud/github-repo}}`
* UpdateGitHubSourceCode - `{{resolve:ssm:/readysetcloud/update-github-source-code}}`
* AdminEmail - `{{resolve:ssm:/readysetcloud/admin-email}}`
* BucketName - `{{resolve:ssm:/readysetcloud/assets-bucket}}`
* AmplifyAppId - `{{resolve:ssm:/readysetcloud/amplify-app-id}}`
* DefaultCacheName - `{{resolve:ssm:/readysetcloud/cache-name}}`
* Secrets - `{{resolve:ssm:/readysetcloud/secrets}}`
* Sending an HTTP API Request - `{{resolve:ssm:/readysetcloud/send-api-request}}`
* Querying OpenAI - `{{resolve:ssm:/readysetcloud/ask-openai}}`
* Cognito User Pool ID - `{{resolve:ssm:/readysetcloud/auth/user-pool-id}}`
* Cognito User Pool ARN - `{{resolve:ssm:/readysetcloud/auth/user-pool-arn}}`
* Cognito User Pool Client ID - `{{resolve:ssm:/readysetcloud/auth/user-pool-client-id}}`
* Core API URL - `{{resolve:ssm:/readysetcloud/api-url}}` (prod: `https://api.readysetcloud.io/core`)

## Badge Chest — cross-app gamification

The badge chest is a single, ecosystem-wide trophy case. Because every app
shares one Cognito user pool, a user's Cognito `sub` is a universal identity, so
badges, points, and levels earned in any app roll up into one profile stored in
`RSCCoreTable`.

> **Full integration & authoring guide:** [`functions/badges/AGENTS.md`](functions/badges/AGENTS.md)
> — how to emit activity from an app, how to author a badge (criteria types,
> counter scoping, gotchas), the events the engine emits, and the data model.
> The section below is the overview.

### How it works

1. **Apps emit activity.** An app tells core that something happened — either by
   putting a `Track Activity` event on the default EventBridge bus, or by having
   a signed-in user `POST /badges/activity`.
2. **The rules engine awards badges.** `ProcessActivityFunction` counts the
   activity, checks the central catalog (`functions/badges/catalog.json`), and
   idempotently awards any newly-earned badges, adding their points to the
   user's total and recomputing their level (`functions/badges/levels.json`).
3. **Core announces it.** A `Badge Awarded` (and, on a level change, `Level Up`)
   event goes back on the bus for any app to react to (toast, email, etc.).
4. **Apps read the chest.** The shared `<BadgeChest>` component in
   `@readysetcloud/ui` calls `GET /badges/me` to render the user's badges,
   points, level, and progress identically everywhere.

### Activity event contract

Emit this to the default bus (or POST the `detail` body, minus `userId`, to
`/badges/activity` where `userId` is taken from the JWT):

```json
{
  "Source": "<your-app>",
  "DetailType": "Track Activity",
  "Detail": {
    "id": "<uuid>",            // optional idempotency key — reuse on retries
    "userId": "<cognito sub>", // required for bus events; set from JWT by the API
    "action": "lesson.completed",
    "count": 1,                 // optional, default 1
    "value": "bootcamp",       // optional — distinct value for `unique` badges
    "service": "bootcamp"      // optional — enables per-service badge criteria
  }
}
```

### Adding a badge

Add an entry to `functions/badges/catalog.json` and redeploy. Supported
criteria types:

* `count` — award at `threshold` occurrences of `metric` (add `service` to
  scope the count to one app).
* `unique` — award when `threshold` distinct `value`s are seen for `metric`
  (e.g. "visited every app").
* `meta` — award when `threshold` of the listed `badges` are earned (e.g.
  "collect them all").

Adding a badge does **not** retroactively scan history — a user earns it on
their next matching activity, so plan a replay/backfill for badges added after
launch. See the [authoring guide](functions/badges/AGENTS.md#authoring-a-badge)
for criteria/counter details and the events the engine emits.

### API

Badge routes are served by the shared **Core API** (`AWS::Serverless::Api`
`CoreApi`, a REST API). Its base URL is published to SSM at
`/readysetcloud/api-url`. In prod (any deploy with `RootDomainName` set) it is
fronted by the `/core` base path of the shared `api.${RootDomainName}` custom
domain — e.g. `https://api.readysetcloud.io/core`; non-prod deploys fall back to
the generated `execute-api` URL (which includes the `/Prod` stage). This is the ecosystem's core API
surface — badges are its first routes, more will live here over time.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /badges/me` | Cognito JWT | The caller's chest: badges, points, level, in-progress |
| `GET /badges/catalog` | none | Every earnable badge + the level ladder |
| `POST /badges/activity` | Cognito JWT | Record activity for the caller |

## Link shortening — short links, redirects & campaigns

A reusable, ecosystem-wide URL shortener. Any app mints a 6-char code for a
destination URL, visitors hit `https://<base>/<code>` and are 302'd **at the
CloudFront edge** (no Lambda in the hot path), codes can be grouped into
campaigns, and every redirect rolls up into per-code and per-campaign click
analytics. Expired codes are swept daily.

> **Full guide:** [`functions/LINKS.md`](functions/LINKS.md) — data model,
> routes, the edge redirect + click pipeline, and the SSM contract.
> **Client:** [`@readysetcloud/links`](links/README.md).

### How it works

1. **Mint.** A backend calls `createShortLink({ url, campaignId })` from
   `@readysetcloud/links` (or `POST /links` directly). Core stores the metadata
   in `LinksTable` and writes the `code → url` mapping into a CloudFront Key
   Value Store.
2. **Redirect.** A visitor hits `https://<base>/<code>`. A CloudFront Function
   looks the code up in the KVS and 302s to the destination, logging a compact
   `{ code, u, src, ip, s }` line — all at the edge.
3. **Count.** A CloudWatch Logs subscription fans those lines to
   `ProcessLinkClick`, which records a click event and upserts the per-code
   aggregate.
4. **Read.** `GET /links/{code}/analytics` and
   `GET /campaigns/{campaignId}/links/analytics` return totals, by-day, and
   by-source breakdowns.

### API (`LinksApi`, IAM-authed service-to-service)

The management routes are served by a dedicated REST API whose default
authorizer is **`AWS_IAM`** — a backend signs requests with SigV4 (the
`@readysetcloud/links` client does this for you; grant its role
`execute-api:Invoke`). The public redirect is a separate CloudFront
distribution, not this API.

| Method & path | Purpose |
| --- | --- |
| `POST /links` | Mint a code (`url`, optional `src`, `campaignId`, `expiresInDays`) |
| `GET /links/{code}` | Fetch a link's metadata |
| `PUT /links/{code}` | Repoint a code at a new URL |
| `DELETE /links/{code}` | Remove the code (metadata, clicks, edge entry) |
| `GET /links/{code}/analytics` | Per-code click aggregate |
| `GET /campaigns/{campaignId}/links/analytics` | Every link in a campaign + its clicks |

The base URLs are published to SSM: `/readysetcloud/links/short-link-base`
(append `/{code}`) and `/readysetcloud/links/api-base-url` (what the client
signs against).

## Agent service — streaming AI chat

A Strands-TS assistant ([`@readysetcloud/agent`](agent/README.md)) hosted in
**AgentCore Runtime** (NODE_22) that streams responses to the browser over a
direct WebSocket. It shares the ecosystem's Cognito pool and a managed
cross-session memory model (AgentCore Memory), so any app can drop in a chat
surface with [`@readysetcloud/ui/chat`](ui/AGENTS.md).

### How it works

1. **Configure a session.** A signed-in caller `POST /agent/sessions` (or
   backend code calls `createSession()` from `@readysetcloud/agent`) to create a
   session with an optional `systemPrompt`, `modelId`, `temperature`,
   `maxTokens`, `title`, first-party `tools`, and external `mcpServers` — all
   defaulted/omitted when unset. The row is stored at `pk=SESSION#{id},
   sk=CONFIG` and **owned by the verified caller**. This is the knob for agent
   behavior: **the deployed runtime is a generic host, so changing prompts,
   models, or tools is a data operation here, never a redeploy.** `mcpServers`
   is the one place a session points the runtime at an outbound URL, so
   `create-session` rejects any host not in `MCP_ALLOWED_HOSTS` (the
   `McpAllowedHosts` parameter; empty rejects all — opt in explicitly) as an
   SSRF guard. A spec's `authHeader` carries an authority-minted token that the
   runtime forwards verbatim to that MCP server, propagating the verified user's
   identity to a per-tenant tool — see the [package
   README](agent/README.md#mcp-servers-external-tools).
2. **Get the URL.** The browser calls `POST /agent/connect` with that
   `sessionId`. `WebSocketConnectFunction` returns the `wss://` URL to the
   AgentCore Runtime (with the runtime session id as a query param) — no signing.
   When a custom domain is deployed, that URL points at the
   `chat.${RootDomainName}` CloudFront proxy (see below) instead of the raw
   `bedrock-agentcore` host, so the AWS account id never appears in the
   client-visible URL.
3. **Stream.** The browser opens the socket (directly or through the proxy),
   presenting its **Cognito ID token as an OAuth bearer** in the
   `Sec-WebSocket-Protocol` handshake header
   (`base64UrlBearerAuthorization.<base64url(jwt)>`). The runtime's **inbound JWT
   authorizer** (`AuthorizerConfiguration`, validating the shared user pool)
   verifies the token before the request lands, then forwards it as the
   `Authorization` header; the runtime reads the verified `sub` from it — the
   agent's identity is the real caller, never a client value. The runtime then
   **loads the session's config by `sessionId`, enforces that the verified caller
   is the session's owner** (a leaked/guessed id can't resume someone else's
   conversation; missing config falls back to defaults), builds the assistant,
   and streams `stream_event` → `complete` frames over the wire protocol
   `@readysetcloud/ui/chat` speaks.

   > **Reverse proxy (custom-domain deploys).** The URL would otherwise expose
   > the account id — it sits in the runtime ARN in the path
   > (`…/runtimes/arn:aws:bedrock-agentcore:<region>:<account>:runtime/…/ws`).
   > `ChatProxyDistribution` fronts the runtime at `wss://chat.${RootDomainName}`:
   > the browser connects to `/ws?<session-id query>`, CloudFront prepends
   > `/runtimes/<arn>` (OriginPath) and restores the `bedrock-agentcore` Host
   > (the `AllViewerExceptHostHeader` managed policy, which also forwards the
   > `Sec-WebSocket-Protocol` bearer). Only the URL is rewritten; the bearer token
   > still authorizes the connection at the runtime. The account id is gone.
4. **Remember.** Memory is two-plane. *Within/across a connection,* Strands
   conversation **snapshots** persist to `AgentChatTable`
   (`pk=SESSION#{sessionId}`, TTL `expiresAt`) so a conversation resumes exactly.
   *Across sessions,* the runtime hands each turn to the managed **AgentCore
   Memory** resource (`createEvent`); AgentCore asynchronously extracts long-term
   records — **facts** (`/facts/{sub}`) and **user preferences**
   (`/users/{sub}/preferences`), scoped per verified caller — and the Strands
   `memoryManager` injects the relevant ones into each turn automatically (plus a
   `search_memory` tool for explicit lookups). This replaces the old S3 Vectors +
   Titan + stream-vectorizer stack.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /agent/sessions` | Cognito JWT | Create a session (prompt/model/params); returns `{ sessionId }` |
| `POST /agent/connect` | Cognito JWT | `wss://` URL to the runtime for a `sessionId` (auth is the bearer on the socket, not a signed URL) |
| `POST /agent/tasks` | Cognito JWT | Trigger an autonomous (non-chat) task; `wait` (default) returns the result inline for a quick run, else `202 { taskId }` + a result event |
| `GET /agent/tasks/{taskId}` | Cognito JWT | Read a task's status/result (owner only) |

### Autonomous tasks (non-chat agents)

Alongside streaming chat, the runtime runs **autonomous tasks** — a one-shot "do
something" invocation of the agent through the *same* secure environment, with no
browser or socket. Two triggers land on the same path: `POST /agent/tasks` (the
verified caller is the task's `user` principal by default; `wait` returns the
result inline under the REST API's ~29s window, else a `202` + event), and a
`"Run Agent Task"` event a first-party backend emits via `@readysetcloud/agent`
`requestAgentTask` (the decoupled path). `RunAgentTaskFunction` runs the agent
**in-Lambda** via the portable `@readysetcloud/agent` core (same Bedrock grant,
MCP allowlist, and table as chat) and owns the durable lifecycle — a conditional
task row (`pk=TASK#{taskId}`) makes the run **idempotent** under at-least-once
delivery, an in-memory cache serves warm-instance duplicates, and it emits
`"Agent Task Completed"` on every outcome so the result reaches consumers over the
bus even when a slow run outlives the caller's wait. Identity is the event's
`principal`, asserted by the first-party emitter — the same trust model as the
"Create Agent Session" handoff.

> **Why in-Lambda, not the AgentCore runtime?** The chat runtime uses a Cognito
> **JWT** inbound authorizer (for the browser), and an AgentCore runtime is JWT-
> *or* IAM-authorized, never both — so an IAM-invoked, no-JWT task call can't
> reach it. Running the portable core in a Lambda keeps tasks inside the same
> account/guarantees without a second runtime.

**System-scoped runs.** A first-party backend emitting a `"Run Agent Task"` event
may assert a `system` principal (id = a service, e.g. `booked`) freely — the bus
is account-internal. A *public* `POST /agent/tasks` caller may request one by
passing `system: '<id>'`, but only if their verified `sub` is allowlisted for
that id in the **`SystemTaskPrincipals`** deploy parameter (comma-separated
`sub:systemId` grants; `sub:*` allows any; empty rejects all — opt in, like
`McpAllowedHosts`). The human launcher is recorded as `createdBy` so they can
still `GET` the task even though the run acts as the system. See the [package
README](agent/README.md#autonomous-tasks-non-chat-agents).

### Pieces

| Piece | Where |
| --- | --- |
| Portable agent core (assistant, snapshots, streaming) | `@readysetcloud/agent` → [`agent/`](agent/) |
| AgentCore Runtime artifact (NODE_22 WebSocket host, AgentCore Memory wiring) | [`agent-runtime/`](agent-runtime/) |
| Session + connect Lambdas | [`functions/create-session.mjs`](functions/create-session.mjs), [`functions/websocket-connect.mjs`](functions/websocket-connect.mjs) |
| Autonomous task Lambdas (create/get + `Run Agent Task` consumer) | [`functions/create-task.mjs`](functions/create-task.mjs), [`functions/get-task.mjs`](functions/get-task.mjs), [`functions/run-agent-task.mjs`](functions/run-agent-task.mjs) |
| Infra (table, AgentCore Memory, runtime, IAM, `POST /agent/sessions` + `/agent/connect` + `/agent/tasks`) | [`template.yaml`](template.yaml) |
| Artifact packaging (esbuild bundle + arm64 node_modules) | [`scripts/package-agent.mjs`](scripts/package-agent.mjs) |
| React chat surface | `@readysetcloud/ui/chat` → [`ui/src/chat/`](ui/src/chat/) |

The deploy builds the agent package (inlined into the runtime bundle) and
packages + uploads the runtime artifact to the assets bucket before `sam deploy`.

### Frontend consumer

Any RSC app renders chat by pairing `@readysetcloud/ui/auth` with
`@readysetcloud/ui/chat`. The app owns auth and injects a `getConnectionUrl`;
the chat components never import app auth.

```tsx
import { Chat } from '@readysetcloud/ui/chat';
import { useAuth } from '@readysetcloud/ui/auth';

const { user, getToken } = useAuth();
const authed = async (path, body) =>
  (await fetch(`${CORE_API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();

// base64url without padding — how AgentCore expects the bearer in the subprotocol.
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 1. Create a session once (optionally set prompt/model), keep the id in state.
const { sessionId } = await authed('/agent/sessions', { systemPrompt, modelId });

// 2. Per (re)connect, return the URL + the Cognito ID token as an OAuth bearer
//    subprotocol. The runtime's inbound JWT authorizer validates it and reads the
//    verified sub server-side — never pass a user id from the client.
const getConnectionUrl = async (sid?: string) => {
  const { wsUrl } = await authed('/agent/connect', { sessionId: sid });
  const token = await getToken();
  return {
    url: wsUrl,
    protocols: [`base64UrlBearerAuthorization.${b64url(token)}`, 'base64UrlBearerAuthorization'],
  };
};

// 3. Render.
<Chat sessionId={sessionId} userId={user.sub} getConnectionUrl={getConnectionUrl} title="Assistant" />;
```

`CORE_API_URL` is the SSM `/readysetcloud/api-url` value (prod:
`https://api.readysetcloud.io/core`). Omit the `POST /agent/sessions` body to take
all defaults; the runtime also falls back to defaults if a session has no config
row.

### Verify on first deploy (not checkable without AWS)

- **`AWS::BedrockAgentCore::Runtime` `EntryPoint: index.js`** — cfn-lint's spec
  doesn't yet know the Node runtimes (`E3030 NODE_22`) and there's no first-party
  TS WebSocket tutorial, so confirm the literal against a real deploy.
- **Inbound JWT authorizer** — confirm the runtime's
  `AuthorizerConfiguration.CustomJWTAuthorizerConfiguration` accepts the browser's
  Cognito **ID** token: `AllowedAudience` matches the token `aud` (the app client
  id), and the `DiscoveryUrl` issuer matches the token `iss`. A rejected token
  closes the socket (codes `4401`/`1008`, which the UI client surfaces).
- **Bearer over WebSocket** — confirm AgentCore accepts the OAuth bearer in the
  `Sec-WebSocket-Protocol` subprotocol (`base64UrlBearerAuthorization.<b64url>`)
  with the runtime session id as a query param, and that the CloudFront proxy
  forwards that subprotocol header. This mirrors the `bedrock-agentcore` SDK's own
  browser helper (`RuntimeClient.connectShellOAuth`).
- **Verified identity in the runtime** — confirm AgentCore forwards the validated
  token as the `Authorization` header (the SDK filters headers to
  `Authorization` + `Custom-*`), so `getUserId` decodes the `sub`. If it surfaces
  identity differently, adjust `agent-runtime/src/index.ts`.
- **AgentCore Memory resource** — cfn-lint won't know
  `AWS::BedrockAgentCore::Memory`; confirm on a real deploy that the
  `MemoryStrategies` shape (`SemanticMemoryStrategy`/`UserPreferenceMemoryStrategy`
  wrappers, `NamespaceTemplates`), `EventExpiryDuration` (days), and the
  `!GetAtt AgentMemory.MemoryId` / `.MemoryArn` attributes resolve. The
  `bedrock-agentcore/experimental/memory/strands` subpath is **experimental**
  (pinned exact at 0.4.0) — re-verify the `createAgentCoreMemoryStores` signature
  on any bump.
- **Memory read/write path** — confirm the runtime's read namespaces
  (`/facts/<sub>`, `/users/<sub>/preferences`) match the resource's strategy
  `NamespaceTemplates` after `{actorId}` resolves, that `createEvent` writes
  succeed, and that long-term records appear (extraction is async — allow a lag).
- **End-to-end stream** — sign in → `POST /agent/connect` → open the socket →
  confirm `stream_event`→`complete`, multi-turn continuity (snapshots), and that
  cross-session facts/preferences are injected (and `search_memory` returns them)
  on a later session.
- **arm64 packaging** — `scripts/package-agent.mjs` stages the zip; confirm it
  runs on the runtime (all deps are pure-JS today).
