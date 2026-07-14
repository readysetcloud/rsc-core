import { execSync } from 'node:child_process';
import { rm, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Assembles the AgentCore CodeZip artifact: the esbuild bundle (index.js) plus a
// production node_modules built for linux-arm64. The deploy workflow zips the
// staging dir and uploads it to s3://<BucketName>/<AgentArtifactKey>; the
// AWS::BedrockAgentCore::Runtime EntryPoint is index.js.
//
// Third-party runtime deps are listed here (they match what agent-runtime's
// build.mjs marks external). @readysetcloud/agent is NOT listed — it's inlined
// into the bundle, so no local-package juggling is needed in the artifact.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agentPkgDir = join(root, 'agent');
const runtimeDir = join(root, 'agent-runtime');
const staging = join(runtimeDir, '.artifact');

// Strands + AgentCore are pinned exact (0.x/young, churn-prone) so the deployed
// artifact is reproducible and matches what the agent package's contract test
// verified against.
const RUNTIME_DEPS = {
  '@strands-agents/sdk': '1.9.0',
  'bedrock-agentcore': '0.4.0',
  '@aws-sdk/client-dynamodb': '^3.0.0',
  '@aws-sdk/lib-dynamodb': '^3.0.0',
  '@aws-sdk/client-s3vectors': '^3.0.0',
  '@aws-sdk/client-bedrock-runtime': '^3.0.0',
  zod: '^4.1.12',
};

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// 1. Build @readysetcloud/agent (inlined into the artifact) then the runtime bundle.
run('npm ci', agentPkgDir);
run('npm run build', agentPkgDir);
run('npm ci', runtimeDir);
run('npm run build', runtimeDir);

// 2. Fresh staging dir with the bundle + a minimal package.json.
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await copyFile(join(runtimeDir, 'dist', 'index.js'), join(staging, 'index.js'));
await writeFile(
  join(staging, 'package.json'),
  JSON.stringify(
    { name: 'rsc-agent-runtime-artifact', version: '0.1.0', type: 'module', dependencies: RUNTIME_DEPS },
    null,
    2,
  ),
);

// 3. Install production deps for the linux-arm64 target (all pure-JS today, but
//    the flags keep the artifact correct if a native dep ever sneaks in).
run('npm install --omit=dev --os=linux --cpu=arm64 --no-audit --no-fund', staging);

console.log(`\nAgent artifact staged at ${staging}`);
console.log('Zip its contents (index.js + node_modules + package.json) and upload to S3.');
