# @readysetcloud/links

Node client for the Ready, Set, Cloud link-shortening service. Mint short links,
manage them, and read click analytics from any RSC app's backend without
hand-rolling SigV4-signed HTTP.

The service itself (edge redirect, management API, analytics, expiry) lives in
[rsc-core](https://github.com/readysetcloud/rsc-core) — see
[`functions/LINKS.md`](https://github.com/readysetcloud/rsc-core/blob/main/functions/LINKS.md).

## Install

```bash
npm install @readysetcloud/links
```

## Auth & configuration

The management API is **IAM-authorized**. Requests are signed with the ambient
AWS credentials (service `execute-api`), so the calling Lambda's execution role
must be granted `execute-api:Invoke` on the links API:

```yaml
- Effect: Allow
  Action: execute-api:Invoke
  Resource: !Sub arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${LinksApiId}/Prod/*/*
```

The API base URL is taken from `process.env.LINKS_API_URL` when set, otherwise
resolved (and cached) from SSM at `/readysetcloud/links/api-base-url`. Resolving
from SSM needs `ssm:GetParameter` on that parameter; setting `LINKS_API_URL`
directly (e.g. via `{{resolve:ssm:/readysetcloud/links/api-base-url}}` at deploy)
avoids the runtime lookup.

## Usage

```ts
import {
  createShortLink,
  getShortLink,
  updateShortLink,
  deleteShortLink,
  getLinkAnalytics,
  getCampaignLinkAnalytics,
} from '@readysetcloud/links';

// Mint — returns { code, short_url, expires_at }
const { short_url } = await createShortLink({
  url: 'https://example.com/blog/post',
  src: 'newsletter',       // optional source tag recorded on every click
  campaignId: 'launch-2026', // optional — groups links for campaign analytics
  expiresInDays: 90,        // optional — 1..1825, default 730
});

const link = await getShortLink('aB3xY9');
await updateShortLink('aB3xY9', { url: 'https://example.com/new' });

const stats = await getLinkAnalytics('aB3xY9');
// { total_clicks, by_day, by_src, first_click_at, last_click_at }

const campaign = await getCampaignLinkAnalytics('launch-2026');
// { total_links, total_clicks, links: [{ ...link, analytics }] }

await deleteShortLink('aB3xY9');
```

Non-2xx responses throw a `LinksApiError` carrying `status`, `message`, and the
parsed `body`.
