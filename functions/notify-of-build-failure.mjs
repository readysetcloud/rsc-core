import { AmplifyClient, ListJobsCommand } from '@aws-sdk/client-amplify';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { Octokit } from 'octokit';

let octokit;
const amplify = new AmplifyClient();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  await setupOctokit();

  const response = await amplify.send(new ListJobsCommand({
    appId: process.env.APP_ID,
    branchName: 'master',
    maxResults: 3
  }));

  const failedJob = response.jobSummaries.find(j => j.status === 'FAILED');
  const commit = await getCommitDetails(failedJob.commitId);

  const email = composeEmail(commit, failedJob.commitId);
  await eventBridge.send(new PutEventsCommand({
    Entries: [
      {
        Source: 'rsc.failuredaemon',
        DetailType: 'Send Email',
        Detail: JSON.stringify(email)
      }
    ]
  }
  ));
};

const getCommitDetails = async (commit) => {
  const commitDetail = await octokit.rest.repos.getCommit({
    owner: process.env.OWNER,
    repo: process.env.REPO,
    ref: commit
  });

  return commitDetail.data.commit;
};

const composeEmail = (commit, id) => {
  return {
    to: commit.author.email,
    subject: '[Ready, Set, Cloud!] You broke it.',
    html: `<h2>You messed something up ☹️</h2>
    <p>Hey ${commit.author.name},</p>
    <p>On your <a href="https://github.com/${process.env.OWNER}/${process.env.REPO}/commit/${id}" target="_blank">last commit</a>, you know, the one where you said</p>
    <p><i>${commit.message}</i></p>
    <p>Well... you broke the build. Can you go <a href="https://console.aws.amazon.com/amplify/apps/${process.env.APP_ID}/branches/master/deployments" target="_blank">check it out</a> please?</p>
    <p>Love,</p>
    <p><b>Allen the Enforcer of Successful Builds</b></p>`
  };
};

const setupOctokit = async () => {
  if (!octokit) {
    const secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
    const auth = secrets.github;
    octokit = new Octokit({ auth });
  }

  return octokit;
};
