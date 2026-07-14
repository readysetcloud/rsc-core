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

## Agent service — streaming AI chat

A Strands-TS assistant ([`@readysetcloud/agent`](agent/README.md)) hosted in
**AgentCore Runtime** (NODE_22) that streams responses to the browser over a
direct WebSocket. It shares the ecosystem's Cognito pool and single-conversation
memory model, so any app can drop in a chat surface with
[`@readysetcloud/ui/chat`](ui/AGENTS.md).

### How it works

1. **Configure a session.** A signed-in caller `POST /agent/sessions` (or
   backend code calls `createSession()` from `@readysetcloud/agent`) to create a
   session with an optional `systemPrompt`, `modelId`, `temperature`,
   `maxTokens`, `title` — all defaulted when omitted. The row is stored at
   `pk=SESSION#{id}, sk=CONFIG` and **owned by the verified caller**. This is the
   knob for agent behavior: **the deployed runtime is a generic host, so changing
   prompts or models is a data operation here, never a redeploy.**
2. **Presign.** The browser calls `POST /agent/connect` with that `sessionId`.
   `WebSocketConnectFunction` returns a SigV4-presigned `wss://` URL to the
   AgentCore Runtime, carrying the verified Cognito `sub` as a custom header — so
   the agent's identity is the real caller, never a client value.
3. **Stream.** The browser opens the presigned socket directly to the runtime.
   The runtime **loads the session's config by `sessionId`, enforces that the
   verified caller is the session's owner** (a leaked/guessed id can't resume
   someone else's conversation; missing config falls back to defaults), builds
   the assistant, and streams `stream_event` → `complete` frames over the wire
   protocol `@readysetcloud/ui/chat` speaks.
4. **Remember.** Each turn is written to `AgentChatTable` (`pk=MEMORY#{userId}` /
   `SESSION#{sessionId}`, TTL `expiresAt`). A stream filter on `entity=Turn`
   drives `VectorizeTurnFunction`, which embeds turns (Titan v2 @ 1024) into the
   `conversation-memory` **S3 Vectors** index. The agent's `recall_memory` tool
   queries that index, scoped to the caller, for cross-session recall.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /agent/sessions` | Cognito JWT | Create a session (prompt/model/params); returns `{ sessionId }` |
| `POST /agent/connect` | Cognito JWT | Presigned `wss://` URL to the runtime for a `sessionId` |

### Pieces

| Piece | Where |
| --- | --- |
| Portable agent core (assistant, memory, streaming) | `@readysetcloud/agent` → [`agent/`](agent/) |
| AgentCore Runtime artifact (NODE_22 WebSocket host) | [`agent-runtime/`](agent-runtime/) |
| Session, presign + vectorizer Lambdas | [`functions/create-session.mjs`](functions/create-session.mjs), [`functions/websocket-connect.mjs`](functions/websocket-connect.mjs), [`functions/vectorize-turn.mjs`](functions/vectorize-turn.mjs) |
| Infra (table, S3 Vectors, runtime, IAM, `POST /agent/sessions` + `/agent/connect`) | [`template.yaml`](template.yaml) |
| Artifact packaging (esbuild bundle + arm64 node_modules) | [`scripts/package-agent.mjs`](scripts/package-agent.mjs) |
| React chat surface | `@readysetcloud/ui/chat` → [`ui/src/chat/`](ui/src/chat/) |

The deploy builds the agent package (its `/memory` subpath is bundled into the
vectorizer) and packages + uploads the runtime artifact to the assets bucket
before `sam deploy`.

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

// 1. Create a session once (optionally set prompt/model), keep the id in state.
const { sessionId } = await authed('/agent/sessions', { systemPrompt, modelId });

// 2. Presign per (re)connect. The verified sub becomes the agent's userId
//    server-side — never pass it from the client.
const getConnectionUrl = async (sid?: string) => (await authed('/agent/connect', { sessionId: sid })).wsUrl;

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
- **End-to-end stream** — sign in → `POST /agent/connect` → open the socket →
  confirm `stream_event`→`complete`, multi-turn continuity (snapshots), and that
  `recall_memory` returns prior-session facts.
- **arm64 packaging** — `scripts/package-agent.mjs` stages the zip; confirm it
  runs on the runtime (all deps are pure-JS today).
- **Runtime-provided SDK** — `websocket-connect.mjs` treats `@aws-sdk/*`
  (incl. `@aws-sdk/credential-provider-node`) as runtime-provided; confirm they
  resolve on the Node 24 Lambda runtime.
