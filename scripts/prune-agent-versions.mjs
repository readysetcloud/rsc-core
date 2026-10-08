/*
 * Deletes old versions of the stage AgentCore runtime so PR deploys stay under
 * the per-runtime version quota. Every deploy that changes agent/ rolls a new
 * runtime version; on stage that happens on every agent PR and the quota fills
 * up (raising it takes AWS Support weeks). Prod has a much higher limit and
 * must never run this.
 *
 * Keeps the newest N versions (default 10) plus any version an endpoint
 * points at, and deletes the rest. It refuses to run unless
 * PRUNE_AGENT_VERSIONS=stage, which only the PR (stage) workflow sets.
 *
 * Usage: PRUNE_AGENT_VERSIONS=stage AWS_REGION=us-east-1 \
 *          node scripts/prune-agent-versions.mjs <runtimeId> [keep=10] [--dry-run]
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

if (process.env.PRUNE_AGENT_VERSIONS !== 'stage') {
  console.error('Refusing to prune: set PRUNE_AGENT_VERSIONS=stage. This script is for the stage (PR) workflow only.');
  process.exit(1);
}

const [runtimeId, keepArg = '10', flag] = process.argv.slice(2);
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
console.log(`${versions.length} versions; keeping ${versions.length - doomed.length} (newest ${keep} + in use: ${[...inUse].join(', ') || 'none'}); deleting ${doomed.length}`);

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
