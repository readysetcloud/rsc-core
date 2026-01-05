import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromIni } from '@aws-sdk/credential-providers';

const args = normalizeArgs(parseArgs(process.argv.slice(2)));
if (!args.bucket || !args.functionName) {
  console.error('Usage: node scripts/backfill-webp.mjs --bucket <bucket> --function <lambdaName> [--profile <profile>] [--prefix <prefix>] [--concurrency <n>] [--dry-run]');
  process.exit(1);
}

const concurrency = Number(args.concurrency || 5);
const prefix = args.prefix || '';
const dryRun = Boolean(args.dryRun);
const profile = args.profile || '';

const credentials = profile ? fromIni({ profile }) : undefined;
const s3 = new S3Client(credentials ? { credentials } : {});
const lambda = new LambdaClient(credentials ? { credentials } : {});

await main();

async function main() {
  await listAndInvoke({
    bucket: args.bucket,
    functionName: args.functionName,
    prefix,
    concurrency,
    dryRun
  });
}

const listAndInvoke = async ({ bucket, functionName, prefix, concurrency, dryRun }) => {
  let continuationToken;
  let processed = 0;
  const queue = [];

  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken
    }));

    for (const object of resp.Contents || []) {
      const key = object.Key;
      if (!key || key.toLowerCase().endsWith('.webp') || key.toLowerCase().endsWith('.mp3')) {
        continue;
      }

      const payload = JSON.stringify({
        'detail-type': 'Object Created',
        detail: {
          bucket: { name: bucket },
          object: { key }
        }
      });

      if (dryRun) {
        console.log(`dry-run: ${key}`);
        continue;
      }

      queue.push(invokeLambda(functionName, payload, key));
      if (queue.length >= concurrency) {
        await Promise.allSettled(queue);
        queue.length = 0;
      }

      processed += 1;
      if (processed % 100 === 0) {
        console.log(`queued ${processed} objects...`);
      }
    }

    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  if (queue.length) {
    await Promise.allSettled(queue);
  }

  console.log(`done: queued ${processed} objects`);
}

const invokeLambda = async (functionName, payload, key) => {
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(payload)
    }));
  } catch (err) {
    console.error('invoke failed', { key, err });
  }
}

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[name] = true;
    } else {
      out[name] = next;
      i += 1;
    }
  }
  return out;
}

const normalizeArgs = (args) => {
  if (!args.functionName && args.function) {
    return { ...args, functionName: args.function };
  }
  return args;
}
