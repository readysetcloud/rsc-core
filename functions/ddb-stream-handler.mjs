import { unmarshall } from '@aws-sdk/util-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
const eventBridge = new EventBridgeClient();

export const handler = async (event) => {
  try {
    await Promise.allSettled(event.Records.map(async (r) => await handleRecord(r)));
  } catch (err) {
    console.error(err);
  }
};

const handleRecord = async (record) => {
  // eslint-disable-next-line no-unused-vars
  const { pk, sk, ...tenant } = unmarshall(record.dynamodb.NewImage);

  switch (record.eventName) {
    case 'MODIFY':
      await eventBridge.send(new PutEventsCommand({
        Entries: [
          {
            Source: 'rsc-core',
            DetailType: 'Add/Update Tenant',
            Detail: JSON.stringify({
              ...tenant
            })
          }
        ]
      }));
      break;
  }
};
