import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient();
const ssm = new SSMClient();

export const handler = async (event) => {
  const { sub } = event.requestContext.authorizer.claims;
  console.log(sub);
  const result = await ddb.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: sub,
      sk: 'tenant'
    })
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: 'You are not in the system. Please contact an administrator or sign up again.' })
    };
  }

  const tenant = unmarshall(result.Item);
  const data = {
    ...tenant,
    ...JSON.parse(event.body)
  };

  if (!data.tenantId && !data.name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Name is required.' })
    };
  } else if (!data.tenantId) {
    data.tenantId = data.name.replace(/[^A-Za-z0-9]+/g).toLowerCase();
    data.apiKeyParameter = `/rsc/${data.tenantId}`;
    await ssm.send(new PutParameterCommand({
      Name: `/rsc/${data.tenantId}`,
      Value: data.apiKeys ? JSON.stringify(data.apiKeys) : '{}',
      Type: 'SecureString',
      Overwrite: true
    }));
  } else if (data.apiKeys) {
    await ssm.send(new PutParameterCommand({
      Name: `/rsc/${data.tenantId}`,
      Value: JSON.stringify(data.apiKeys),
      Type: 'SecureString',
      Overwrite: true
    }));
  }
  console.log(tenant);
  await ddb.send(new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({ tenant })
  }));
  return { statusCode: 204 };
};
