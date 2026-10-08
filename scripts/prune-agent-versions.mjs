/*
 * Deletes old versions of the AgentCore runtime so deploys stay under the
 * AgentCore version quota. Every deploy that rolls the runtime creates a new,
 * immutable version, and nothing ever removes old ones; raising the quota takes
 * AWS Support weeks. Both deploy workflows run this before deploying: the PR
 * workflow on stage, deploy.yaml on prod.
 *
 * Keeps the newest N versions (default 3) plus any version an endpoint points
 * at, and deletes the rest. A failed deploy's rollback issues a new update
 * rather than reusing an old version, so older versions are never needed.
 * It refuses to run unless PRUNE_AGENT_VERSIONS names the environment (stage
 * or prod), which only the workflows set, so it is never run by accident.
 *
 * Usage: PRUNE_AGENT_VERSIONS=stage|prod AWS_REGION=us-east-1 \
 *          node scripts/prune-agent-versions.mjs <runtimeId> [keep=3] [--dry-run]
 *
 * Deletion is asynchronous; the script waits up to two minutes for it to finish.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BedrockAgentCoreControlClient,
  ListAgentRuntimeVersionsCommand,
  ListAgentRuntimeEndpointsCommand,
  DeleteAgentRuntimeCommand
} from '@aws-sdk/client-bedrock-agentcore-control';

const environment = process.env.PRUNE_AGENT_VERSIONS;
if (environment !== 'stage' && environment !== 'prod') {
  console.error('Refusing to prune: set PRUNE_AGENT_VERSIONS to stage or prod. The deploy workflows set it; nothing else should.');
  process.exit(1);
}

const [runtimeId, keepArg = '3', flag] = process.argv.slice(2);
const keep = Number(keepArg);
if (!runtimeId || !(keep >= 1)) {
  console.error('Usage: node scripts/prune-agent-versions.mjs <runtimeId> [keep>=1] [--dry-run]');
  process.exit(1);
}
const dryRun = flag === '--dry-run';
const client = new BedrockAgentCoreControlClient({});

const all = async (Command, field) => {
  const out = [];
  let nextToken;
  do {
    const page = await client.send(new Command({ agentRuntimeId: runtimeId, ...(nextToken ? { nextToken } : {}) }));
    out.push(...(page[field] ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
};

const versions = (await all(ListAgentRuntimeVersionsCommand, 'agentRuntimes'))
  .map((v) => v.agentRuntimeVersion)
  .sort((a, b) => Number(b) - Number(a));
const inUse = new Set(
  (await all(ListAgentRuntimeEndpointsCommand, 'runtimeEndpoints'))
    .flatMap((e) => [e.liveVersion, e.targetVersion])
    .filter(Boolean)
);
const doomed = versions.slice(keep).filter((v) => !inUse.has(v));
console.log(`[${environment}] ${versions.length} versions; keeping ${versions.length - doomed.length} (newest ${keep} + in use: ${[...inUse].join(', ') || 'none'}); deleting ${doomed.length}`);

for (const version of doomed) {
  // Without a version, DeleteAgentRuntime deletes the whole runtime. Never let that happen.
  if (!version) throw new Error('Refusing to delete without a version');
  if (dryRun) {
    console.log('would delete', version);
    continue;
  }
  await client.send(new DeleteAgentRuntimeCommand({ agentRuntimeId: runtimeId, agentRuntimeVersion: version }));
  console.log('deleted', version);
}

// Deletion is asynchronous: wait (up to two minutes) until the deleted versions are gone, so the
// deploy that follows has room under the quota.
if (!dryRun && doomed.length > 0) {
  const target = versions.length - doomed.length;
  for (let i = 0; i < 24; i++) {
    const remaining = (await all(ListAgentRuntimeVersionsCommand, 'agentRuntimes')).length;
    if (remaining <= target) {
      console.log(`${remaining} versions remain`);
      break;
    }
    await sleep(5000);
  }
}
