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
* Badge Chest API URL - `{{resolve:ssm:/readysetcloud/badges/api-url}}`

## Badge Chest — cross-app gamification

The badge chest is a single, ecosystem-wide trophy case. Because every app
shares one Cognito user pool, a user's Cognito `sub` is a universal identity, so
badges, points, and levels earned in any app roll up into one profile stored in
`RSCCoreTable`.

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

### API

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /badges/me` | Cognito JWT | The caller's chest: badges, points, level, in-progress |
| `GET /badges/catalog` | none | Every earnable badge + the level ladder |
| `POST /badges/activity` | Cognito JWT | Record activity for the caller |
