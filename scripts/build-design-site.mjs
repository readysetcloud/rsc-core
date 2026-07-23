/*
 * Assembles the design-system guide (GitHub Pages) into dist-design-site/.
 *
 * The guide's pages reference the ui package's OWN stylesheets and browser
 * bundles (ui/styles/*, ui/dist/browser/*, ui/assets/*) — this script just
 * copies the authored pages and the live package files together, so the
 * published guide can never drift from the shipped system.
 *
 * Usage: node scripts/build-design-site.mjs
 * Run `npm run build` in ui/ first (dist/browser must exist).
 */

import { cp, mkdir, rm, access } from 'fs/promises';

const OUT = 'dist-design-site';

try {
  await access('ui/dist/browser');
} catch {
  console.error('ui/dist/browser missing — run `npm run build` in ui/ first.');
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp('design-system', OUT, { recursive: true });
await cp('ui/styles', `${OUT}/ui/styles`, { recursive: true });
await cp('ui/assets', `${OUT}/ui/assets`, { recursive: true });
await cp('ui/dist/browser', `${OUT}/ui/dist`, { recursive: true });

console.log(`Design-system guide assembled in ${OUT}/`);
