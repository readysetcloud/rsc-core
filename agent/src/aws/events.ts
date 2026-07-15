import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

// One shared EventBridge client per execution environment, matching the ddb
// client convention. Region/credentials come from the ambient AWS SDK config.
export const eventBridge = new EventBridgeClient({});
