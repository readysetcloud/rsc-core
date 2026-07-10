/*
 * Publishes the @readysetcloud/ui hosted assets to the assets bucket so any
 * surface can consume the brand with a <link>/<script> tag (same model as
 * Amplify's hosted UI assets):
 *
 *   https://<assets-host>/ui/<version>/styles/index.css
 *   https://<assets-host>/ui/<version>/auth.global.js   (window.rscAuth)
 *   https://<assets-host>/ui/<version>/nav.global.js    (window.rscNav)
 *   https://<assets-host>/ui/latest/...                 (short cache)
 *
 * Versioned paths are immutable (1y cache); latest/ is a 5-minute pointer.
 * Public read comes from the PublicReadUiAssets bucket policy statement.
 *
 * Usage: node scripts/publish-ui-assets.mjs --bucket <name>
 * Run `npm run build` in ui/ first (dist/browser must exist).
 */

import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client();

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json'
};

const args = process.argv.slice(2);
const bucket = args[args.indexOf('--bucket') + 1];
if (!bucket || bucket.startsWith('--')) {
  console.error('Usage: node scripts/publish-ui-assets.mjs --bucket <name>');
  process.exit(1);
}

const { version } = JSON.parse(await readFile('ui/package.json', 'utf8'));

const uploads = [];
for (const [dir, prefix] of [
  ['ui/styles', 'styles'],
  ['ui/dist/browser', '']
]) {
  for (const file of await readdir(dir)) {
    const ext = extname(file);
    if (!CONTENT_TYPES[ext]) continue;
    uploads.push({ path: join(dir, file), key: prefix ? `${prefix}/${file}` : file, ext });
  }
}

if (!uploads.some((u) => u.key === 'auth.global.js')) {
  console.error('ui/dist/browser is missing — run `npm run build` in ui/ first.');
  process.exit(1);
}

for (const { path, key, ext } of uploads) {
  const body = await readFile(path);
  for (const [root, cacheControl] of [
    [`ui/${version}`, 'public, max-age=31536000, immutable'],
    ['ui/latest', 'public, max-age=300']
  ]) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${root}/${key}`,
        Body: body,
        ContentType: CONTENT_TYPES[ext],
        CacheControl: cacheControl
      })
    );
    console.log(`uploaded s3://${bucket}/${root}/${key}`);
  }
}

console.log(`\nPublished @readysetcloud/ui ${version} hosted assets to ${bucket}.`);
