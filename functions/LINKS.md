# Link shortening — short links, redirects & campaigns

A reusable, ecosystem-wide URL shortener living in rsc-core. Any RSC app can mint
a short code for a destination URL, serve a fast edge redirect from it, group
codes into campaigns, and read per-code / per-campaign click analytics. Expired
codes are swept automatically.

This is the backend + infrastructure guide. For the programmatic client, see
[`@readysetcloud/links`](../links/README.md).

## Shape of it

```
mint (IAM API)          redirect (public edge)         analytics
──────────────          ──────────────────────         ─────────
@readysetcloud/links →  https://<base>/<code>          GET /links/{code}/analytics
  POST /links              │ CloudFront Function          (per-code aggregate)
  writes:                  │  • KVS lookup code→url      GET /campaigns/{id}/links/analytics
   • DynamoDB METADATA     │  • 302 to destination         (rolled up across a campaign)
   • CloudFront KVS entry  │  • logs {code,u,src,ip,s}
                           ▼
                    CloudWatch Logs subscription
                           ▼
                    ProcessLinkClick  →  CLICK# events + AGGREGATE upsert
```

The redirect runs entirely at the CloudFront edge (a CloudFront Function reading
a Key Value Store) — **no Lambda in the hot path**. Every hit is logged as a
compact JSON line; a subscription filter fans those logs to `ProcessLinkClick`,
which records the click and rolls up the aggregate. `SweepExpiredLinks` deletes
codes past their `expiresAt` daily.

## Data model (`LinksTable`)

A dedicated table (like `AgentChatTable`), keyed by short code:

| pk | sk | entity | purpose |
| --- | --- | --- | --- |
| `LINK#{code}` | `METADATA` | `ShortLink` | url, src, campaignId, created/updated/expiresAt |
| `LINK#{code}` | `AGGREGATE` | `ShortLinkAggregate` | totalClicks, byDay{}, bySrc{}, first/lastClickAt |
| `LINK#{code}` | `CLICK#{ts}#{ulid}` | `ShortLinkClick` | one click event (TTL 90 days) |

Two GSIs (created with the table, no phased rollout needed):

- **GSI1** — expiry sweep. `GSI1PK = LINK_EXPIRY`, `GSI1SK = {expiresAt ISO}`.
  `SweepExpiredLinks` queries `GSI1SK < now`.
- **GSI2** — campaign grouping. `GSI2PK = LINK_CAMPAIGN#{campaignId}`,
  `GSI2SK = LINK#{createdAt}#{code}`. Written only when a link has a `campaignId`.

`code` is 6 chars of `[A-Za-z0-9]`, allocated with a conditional put and up to 5
collision retries.

## Management API (`LinksApi`)

A dedicated REST API with **`DefaultAuthorizer: AWS_IAM`** — service-to-service,
signed with SigV4. One mono-Lambda (`manage-links.mjs`) handles every route via
the Powertools [event handler](https://docs.aws.amazon.com/powertools/typescript/latest/features/event-handler/rest/)
`Router`; the API is wired as a single `ANY /{proxy+}` catch-all.

| Method & path | Purpose |
| --- | --- |
| `POST /links` | Mint a code for a URL (`url`, optional `src`, `campaignId`, `expiresInDays`) |
| `GET /links/{code}` | Fetch a link's metadata |
| `PUT /links/{code}` | Repoint a code at a new URL (updates KVS too) |
| `DELETE /links/{code}` | Remove the code (metadata, clicks, and KVS entry) |
| `GET /links/{code}/analytics` | Per-code click aggregate |
| `GET /campaigns/{campaignId}/links/analytics` | Every link in a campaign + its clicks |

Validation errors surface as Powertools `HttpError`s (`{ statusCode, error,
message }`): 400 for bad input, 404 for a missing code, 503 if a unique code
can't be allocated.

## Edge redirect

- **`LinkKeyValueStore`** maps `code → { u: destinationUrl, src? }`.
- **`LinkRedirectFunction`** (CloudFront Function, `cloudfront-js-2.0`) reads the
  last path segment, looks it up, and 302s to the destination with `no-store`.
  It guards against redirect loops back to the tracker host, over-long URLs, and
  non-http(s) destinations, and falls back to `LinkRedirectFallbackUrl` (with a
  `?reason=` tag) on any miss.
- **`LinkRedirectDistribution`** fronts it. Set the `LinkRedirectDomain`
  parameter (with `HostedZoneId`) for a custom short domain — otherwise short
  URLs use the generated CloudFront domain. Short URLs are root-level:
  `https://<base>/<code>`.

## Cross-service contract (SSM)

| Parameter | Value |
| --- | --- |
| `/readysetcloud/links/short-link-base` | Base URL for short links (append `/{code}`) |
| `/readysetcloud/links/api-base-url` | IAM-authed management API base (what `@readysetcloud/links` signs against) |

## Consuming from another app

1. Grant the calling Lambda role `execute-api:Invoke` on the `LinksApi`.
2. `npm i @readysetcloud/links` and call `createShortLink({ url, campaignId })` —
   it resolves the API URL from SSM (or `LINKS_API_URL`) and signs with the
   ambient credentials. See the [package README](../links/README.md).

## Pieces

| Piece | Where |
| --- | --- |
| Management mono-Lambda (all `/links` + `/campaigns/.../analytics` routes) | [`manage-links.mjs`](manage-links.mjs) |
| Edge click processor (CloudWatch Logs → analytics) | [`process-link-click.mjs`](process-link-click.mjs) |
| Daily expiry sweep | [`sweep-expired-links.mjs`](sweep-expired-links.mjs) |
| Table, KVS, redirect function + distribution, API, SSM | [`template.yaml`](../template.yaml) |
| Node client | [`@readysetcloud/links`](../links/) |
