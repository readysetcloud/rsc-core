# Badge Chest — integration & authoring guide

Agent/developer guide for the cross-app gamification system in `rsc-core`. Read
this before adding a badge, wiring an app to emit activity, or debugging why a
badge did/didn't award.

- **Consuming from another app?** Start at [Emitting activity](#emitting-activity-for-app-authors).
- **Adding or changing a badge?** Start at [Authoring a badge](#authoring-a-badge).
- **Reading the chest / rendering UI?** See [Reading the chest](#reading-the-chest)
  and the `BadgeChest` section of `ui/AGENTS.md`.

## Mental model

There is **one badge chest per person**, keyed on their Cognito `sub` — which is
the same identity in every RSC app. So badges, points, and levels earned
anywhere roll up into a single profile in the shared `RSCCoreTable`.

```
your app ──"Track Activity"──▶ process-activity ──▶ counters + awards + points/level
   │           (EventBridge bus                          │
   │            or POST /badges/activity)                 ├──▶ "Badge Awarded"
   │                                                      └──▶ "Level Up"
   └──GET /badges/me──▶ renders <BadgeChest>          (back on the bus for anyone)
```

Apps only ever do two things: **emit activity** ("this happened") and
**read the chest** ("show me my badges"). They never decide what a badge is
worth or whether it's earned — the central rules engine owns that.

The moving parts, all in this repo:

| Piece | File | Role |
| --- | --- | --- |
| Catalog | `functions/badges/catalog.json` | The badge definitions (source of truth) |
| Levels | `functions/badges/levels.json` | Point thresholds → levels |
| Art | `functions/badges/art.json`, `ui/assets/badges/*.svg` | Generated SVG medallions (`scripts/build-badge-art.mjs`) |
| Rules (pure) | `functions/utils/badges.mjs` | Indexing, criteria eval, level calc |
| Rules engine | `functions/process-activity.mjs` | Consumes activity, awards, rolls up points |
| Ingress | `functions/record-activity.mjs` | `POST /badges/activity` for clients |
| Read API | `functions/get-badge-chest.mjs`, `get-badge-catalog.mjs` | `GET /badges/me`, `/badges/catalog` |
| UI | `@readysetcloud/ui` → `BadgeChest`, `createBadgeClient` | Render + fetch |

## Emitting activity (for app authors)

An **activity** is a fact: "user X did Y." You emit it; the engine decides
whether it earns anything. Same payload whichever transport you use.

### The activity contract

```json
{
  "id": "8f3c…",            // optional idempotency key (see below)
  "userId": "<cognito sub>", // REQUIRED on the bus; the API sets it from the JWT
  "action": "lesson.completed",
  "count": 1,                // optional, default 1
  "value": "bootcamp",       // optional — the distinct value for `unique` badges
  "service": "bootcamp"      // optional — required for service-scoped badges
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `action` | yes | The metric name. This is the contract — keep it **stable**. Convention: lowercase, dot-namespaced `noun.verb` (`lesson.completed`, `campaign.created`). |
| `userId` | on the bus | The Cognito `sub`. The `POST /badges/activity` endpoint ignores any `userId` in the body and uses the caller's JWT. |
| `id` | recommended | Idempotency key. If set, the engine processes this activity **exactly once** (safe under EventBridge's at-least-once delivery and client retries). Omit only for activity where an occasional double-count is harmless. |
| `count` | no | Increment size (default 1). Use for "read 5 articles at once" style batches. |
| `value` | no | The distinct dimension for `unique` badges (e.g. the service id for "visited every app"). Defaults to `service` if omitted. |
| `service` | no | The emitting app. **Required** if any badge scopes its count to a service (see the gotcha below). |

### Two ways to emit

**Backend (EventBridge, preferred for server-side events):**

```js
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
const eb = new EventBridgeClient();

await eb.send(new PutEventsCommand({
  Entries: [{
    Source: 'bootcamp',            // your app — any value; the engine matches on DetailType
    DetailType: 'Track Activity',
    Detail: JSON.stringify({
      id: `lesson#${userId}#${lessonId}`,
      userId,
      action: 'lesson.completed',
      service: 'bootcamp'
    })
  }]
}));
```

**Client (via the Core API, when there's no backend for the event):**

```ts
import { createBadgeClient } from '@readysetcloud/ui';
const badges = createBadgeClient({ baseUrl: CORE_API_URL, getToken });

await badges.recordActivity({ action: 'lesson.completed', service: 'bootcamp' });
```

`recordActivity` just re-emits a `Track Activity` event with `userId` taken from
the verified token, so both paths land in the same rules engine.

### Picking a good idempotency `id`

Make it deterministic from the thing that happened, so a retry produces the same
id: `lesson#<userId>#<lessonId>`, `subscribe#<userId>`, `visit#<userId>#<service>#<yyyymmdd>`.
The engine writes a short-lived dedupe marker per id; a second delivery of the
same id is dropped before any counter moves.

## Authoring a badge

Add an entry to `functions/badges/catalog.json` and deploy. No code changes are
needed for the three built-in criteria types.

```json
{
  "id": "lesson-streak",
  "name": "Scholar",
  "description": "Completed 10 bootcamp lessons.",
  "icon": "🎓",
  "category": "Learning",
  "tier": "silver",
  "points": 75,
  "service": "bootcamp",
  "criteria": { "type": "count", "metric": "lesson.completed", "threshold": 10, "service": "bootcamp" }
}
```

| Field | Notes |
| --- | --- |
| `id` | Stable, unique, kebab-case. Used as the DynamoDB key — **never reuse or rename** an id that has been awarded. |
| `name`, `description` | Human copy shown in the chest. |
| `icon` | Emoji, used as the centerpiece of the generated art and as the fallback when art is absent. |
| `iconUrl` | **Generated, don't hand-edit.** A self-contained SVG medallion (data URI) produced by `scripts/build-badge-art.mjs` from `icon` + `tier`. The API adds it in `toPublicBadge`; the UI prefers it over `icon`. Re-run the script after adding a badge or changing the art template. |
| `category` | Grouping label (e.g. `Learning`, `Ecosystem`). |
| `tier` | `bronze` \| `silver` \| `gold` \| `platinum` — drives the tile accent. |
| `points` | Added to the user's total when earned; feeds levels (`levels.json`). |
| `service` | Optional label for which app the badge belongs to (display + filtering). Distinct from `criteria.service`, which actually scopes the count. |
| `criteria` | How it's earned — see below. |

### Criteria types

| Type | Shape | Earned when | Reads counter |
| --- | --- | --- | --- |
| `count` | `{ type, metric, threshold, service? }` | `metric` has occurred `threshold`+ times | `progress#<metric>`, or `progress#<service>#<metric>` if `service` set |
| `unique` | `{ type, metric, threshold }` | `threshold`+ **distinct** `value`s seen for `metric` | `unique#<metric>` (a DynamoDB string set) |
| `meta` | `{ type, badges: [...], threshold? }` | `threshold` of the listed badges are earned (default: all) | none — reads the user's earned set |

Examples:

```jsonc
// First time only:
{ "type": "count", "metric": "account.created", "threshold": 1 }

// Used every app in the ecosystem (emit value = service id):
{ "type": "unique", "metric": "service.visited", "threshold": 5 }

// Collect a badge in four corners of the ecosystem:
{ "type": "meta", "badges": ["newsletter-subscriber", "first-lesson", "first-campaign", "green-thumb"], "threshold": 4 }
```

### How activity maps to counters (why scoping matters)

Each activity increments an **ecosystem-wide** counter (`progress#<metric>`),
and — only when the activity carries a `service` **and** some badge scopes that
metric — a **per-service** counter (`progress#<service>#<metric>`). A `unique`
metric instead adds `value` to a distinct set (`unique#<metric>`).

**Gotcha:** a badge with `criteria.service` is only satisfied by the
`progress#<service>#<metric>` counter, which only moves when the emitted
activity includes a matching `service`. If you author a service-scoped badge,
the app **must** emit `service` on that activity, and it must equal
`criteria.service`. Ecosystem badges (no `criteria.service`) count every
occurrence regardless of `service`.

**Gotcha:** a `unique` badge needs a `value` (or a `service`, which is used as
the fallback) on each activity — with neither, there's nothing to add to the
distinct set and the counter never grows.

### Authoring checklist

1. Add the entry to `catalog.json` with a stable `id` (include `icon` + `tier`).
2. Run `node scripts/build-badge-art.mjs` to generate the badge's SVG artwork
   (`ui/assets/badges/<id>.svg`) and refresh `functions/badges/art.json`.
3. Make sure **something emits** the `metric` you reference (an app, or the
   signup hook). A badge whose metric is never emitted can never be earned.
4. If service-scoped, confirm the emitter sends a matching `service`.
5. Bump `version` in `catalog.json` if you want consumers to detect the change.
6. Deploy. `GET /badges/catalog` now advertises it, art included.

**Gotcha — no automatic backfill:** adding a badge does **not** retroactively
scan history. A user who already passed the threshold gets it on their **next**
matching activity (which re-triggers evaluation); if they never do that activity
again, they won't earn it. To grant badges for things that happened before the
badge existed, replay historical activity through the engine or run a one-time
grant. Plan this for any badge added after launch.

## What the engine guarantees

- **Award once.** Badges are written with a conditional put; retries and
  concurrent events can't double-award or double-count points.
- **Exactly-once counting** for activity that carries an `id` (dedupe marker
  with TTL). Without an `id`, counting is at-least-once.
- **Points & levels roll up automatically** on every award; a level change emits
  `Level Up`.
- **Meta badges are re-checked** whenever any badge is newly awarded in the same
  event, so "collect them all" fires as soon as the last dependency lands.
- **Cheap no-ops.** Activity whose `action` no badge references is ignored
  immediately.

## Events the engine emits

React to these on the default bus (e.g. to toast or email the user):

```jsonc
// DetailType: "Badge Awarded"  (one per badge earned)
{ "userId", "badge": { "id", "name", "description", "icon", "iconUrl?", "category", "tier", "points", "service?" },
  "totalPoints", "level", "levelName", "earnedDate" }

// DetailType: "Level Up"  (only when the level changed)
{ "userId", "level", "levelName", "totalPoints" }
```

## Reading the chest

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /badges/me` | Cognito JWT | Caller's chest: badges, points, level, in-progress |
| `GET /badges/catalog` | none | Every earnable badge + the level ladder |
| `POST /badges/activity` | Cognito JWT | Record activity for the caller |

Base URL is in SSM at `/readysetcloud/api-url` (prod: `https://api.readysetcloud.io/core`).
Use `createBadgeClient` + `<BadgeChest>` from `@readysetcloud/ui` so every app
renders identically — see `ui/AGENTS.md`.

## Data model (for debugging)

All items are keyed `pk = <cognito sub>`:

| `sk` | Contents |
| --- | --- |
| `gamification` | `{ totalPoints, badgeCount, level, levelName, updatedDate }` |
| `badge#<id>` | `{ badgeId, points, earnedDate, service? }` — an earned badge |
| `progress#<metric>` | `{ count }` — ecosystem counter |
| `progress#<service>#<metric>` | `{ count }` — per-service counter |
| `unique#<metric>` | `{ values }` — distinct-value string set |
| `evt#<id>` | dedupe marker with `ttl` (auto-expires) |

The pure logic (criteria eval, counter keys, level math) lives in
`functions/utils/badges.mjs` and has no AWS dependencies — reason about or unit
test awarding there without deploying.
