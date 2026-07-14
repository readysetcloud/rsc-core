import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ddb = new DynamoDBClient();
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  const userId = event.request.userAttributes.sub;
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: userId,
        sk: 'tenant',
        signUpDate: new Date().toISOString(),
        ...event.userName && { username: event.userName }
      })
    }));

    // Kick off the gamification loop — earns the "Welcome Aboard" badge.
    await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'rsc-core',
          DetailType: 'Track Activity',
          Detail: JSON.stringify({ id: `account-created#${userId}`, userId, action: 'account.created' })
        }
      ]
    }));
  } catch (err) {
    console.log(err);
  }

  return event;
};
