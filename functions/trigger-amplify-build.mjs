import { AmplifyClient, StartJobCommand } from '@aws-sdk/client-amplify';

const amplify = new AmplifyClient();

export const handler = async (event) => {
  await amplify.send(new StartJobCommand({
    appId: process.env.APP_ID,
    branchName: 'master',
    jobType: 'RELEASE'
  }));
};
