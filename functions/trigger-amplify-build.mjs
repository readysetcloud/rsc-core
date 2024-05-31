import { AmplifyClient, StartJobCommand } from '@aws-sdk/client-amplify';

const amplify = new AmplifyClient();

export const handler = async () => {
  try {
    await amplify.send(new StartJobCommand({
      appId: process.env.APP_ID,
      branchName: 'master',
      jobType: 'RELEASE'
    }));

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false };
  }
};
