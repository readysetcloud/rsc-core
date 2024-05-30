# Core resources and configuration

This is a foundational service of Ready, Set, Cloud and is used to maintain global configuration across all services. It also provides basic administrative functionality for site builds.

## Prerequisites

The following repositories must be deployed into your AWS account for this stack to deploy successfully

* [Serverless toolbox](https://github.com/readysetcloud/serverless-toolbox)

## Configuration

There are several deployment parameters that must be configured that will be saved into SSM parameters for global usage

* **GitHubOwner** - GitHub account owner of the repository containing the site source code
* **GitHubRepo** - GitHub repository name containing the site source code
* **UpdateGitHubSourceCode** - Boolean value indicating if the source code should update GitHub (used for prod/non-prod environments)
* **AdminEmail** - Email address to send notifications to
* **BucketName** - Name of the S3 bucket that holds static assets
* **AmplifyAppId** - Identifier of the Amplify app that hosts and builds the site (used to trigger automations)
* **DefaultCacheName** - Name of the [Momento cache](https://gomomento.com) used to cache data globally

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
