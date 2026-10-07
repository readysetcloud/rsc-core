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

import { cp, mkdir, rm, access, readFile, writeFile } from 'fs/promises';

const OUT = 'dist-design-site';
const SITE = 'https://design.readysetcloud.io';

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

// Publish the agent guide verbatim at /llms.txt (and /AGENTS.md) so LLMs can be
// pointed at the site instead of the repo. Same no-drift rule as the pages: the
// content IS ui/AGENTS.md, plus a short preface linking the machine-readable assets.
const agentGuide = await readFile('ui/AGENTS.md', 'utf8');
const llmsDoc = `<!--
  Published from rsc-core/ui/AGENTS.md on every deploy — do not edit here.
  Machine-readable companions on this site:
    ${SITE}/ui/styles/tokens.css      every design token (color ramps + dark inversion, radii, shadows, fonts)
    ${SITE}/ui/styles/components.css  the shipped component classes
    ${SITE}/components.html           live gallery with paired React/HTML snippets
    ${SITE}/patterns.html             dark mode, responsive contract, how each surface consumes the system
-->

${agentGuide}`;
await writeFile(`${OUT}/llms.txt`, llmsDoc);
await writeFile(`${OUT}/AGENTS.md`, llmsDoc);

// The agent guide (design-system/agent/*.html) documents @readysetcloud/agent
// and the rsc-core agent service. Its LLM-readable companion is the package
// README itself, published verbatim at /agent/llms.txt — same no-drift rule.
const packageGuide = await readFile('agent/README.md', 'utf8');
await writeFile(`${OUT}/agent/llms.txt`, `<!--
  Published from rsc-core/agent/README.md on every deploy — do not edit here.
  Human-readable companions on this site:
    ${SITE}/agent/index.html      overview, capabilities, use cases
    ${SITE}/agent/chat.html       streaming chat: sessions, connect, wire protocol, memory
    ${SITE}/agent/tasks.html      autonomous tasks: triggering, lifecycle, one-shot runs
    ${SITE}/agent/agency.html     persistent agents: triggers, agendas, commitments, check-ins
    ${SITE}/agent/tools.html      tools, identity, principals, allowlists, isolation
    ${SITE}/agent/reference.html  routes, events, exports, environment, table keys
-->

${packageGuide}`);

console.log(`Design-system and agent guides assembled in ${OUT}/`);
