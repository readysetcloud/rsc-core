import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient();

export const handler = async (event) => {
  try {
    await ddb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        pk: event.request.userAttributes.sub,
        sk: 'tenant',
        signUpDate: new Date().toISOString(),
        ...event.userName && { username: event.userName }
      })
    }));
  } catch (err) {
    console.log(err);
  }
};
