import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
let secrets;

export const getSecretValue = async (secretName) => {
  if (!secrets) {
    secrets = await getSecret(process.env.SECRET_ID, { transform: 'json' });
  }

  return secrets[secretName];
};
