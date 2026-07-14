import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';

// Compiles the AgentCore Runtime entrypoint to ESM (dist/index.js) for a
// NODE_22 / arm64 CodeZip deployment. The CloudFormation
// AWS::BedrockAgentCore::Runtime EntryPoint points at index.js.
//
// Strategy: inline our own FIRST-PARTY code (this glue + @readysetcloud/agent,
// resolved from ../agent via a file: dependency) and keep all THIRD-PARTY deps
// external, shipped via a production node_modules alongside the bundle (see
// scripts/package-agent.mjs). This:
//   - avoids resolving @strands-agents/sdk's optional integrations (S3
//     context-offloader, playwright, google/openai) that we don't install, and
//   - keeps the deploy zip's node_modules limited to registry-installable deps.
//
// If a transitive dep ships a native binary that won't cross-compile to
// linux-arm64, switch to the container/ECR deploy path instead.
const EXTERNAL = [
  '@strands-agents/sdk',
  'bedrock-agentcore',
  'fastify',
  '@fastify/*',
  '@aws-sdk/*',
  'zod',
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  external: EXTERNAL,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: false,
  sourcemap: false,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log('Built dist/index.js');
