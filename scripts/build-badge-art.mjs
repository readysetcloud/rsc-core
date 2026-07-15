/*
 * Generates the badge artwork for every badge in the catalog.
 *
 * One shared, tier-aware "metallic medallion" template renders a distinct SVG
 * per badge, using the badge's own emoji as the centerpiece so the art always
 * matches the badge's meaning. Keeping the art programmatic means restyling all
 * badges at once is a single edit here, not 20 hand-drawn files.
 *
 * Outputs:
 *   ui/assets/badges/<id>.svg   — editable source art, one file per badge
 *   functions/badges/art.json   — { <id>: "data:image/svg+xml,..." } consumed
 *                                 by utils/badges.mjs so the Badge Chest API can
 *                                 serve self-contained art in every environment
 *                                 (no asset host / deploy-ordering coupling).
 *
 * Usage: node scripts/build-badge-art.mjs
 * Re-run whenever a badge is added/removed or the art template changes.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(root, 'functions/badges/catalog.json');
const SVG_DIR = join(root, 'ui/assets/badges');
const ART_JSON = join(root, 'functions/badges/art.json');

// Metallic palette per tier: a light highlight, a mid body, and a dark shadow
// for the gradients, plus a stud colour for the rivets around the rim.
const TIERS = {
  bronze: { light: '#f0b978', mid: '#c17d34', dark: '#7c4a1b', stud: '#e6ab6a' },
  silver: { light: '#f6fafc', mid: '#aeb7c0', dark: '#6d7681', stud: '#e6edf3' },
  gold: { light: '#ffe89a', mid: '#e6b422', dark: '#9c7410', stud: '#ffe27a' },
  platinum: { light: '#ffffff', mid: '#cfe0e6', dark: '#7f9fa8', stud: '#eaf4f7' }
};

const CENTER_X = 64;
const CENTER_Y = 58;
const RING_R = 46;
const DISC_R = 35;

/** Escape text before interpolating it into SVG markup (names can contain &, <, >, "). */
const xml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Rivets evenly spaced around the rim of the medallion. */
const studs = (fill) => {
  const count = 12;
  const r = 40.5;
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const cx = (CENTER_X + Math.cos(a) * r).toFixed(2);
    const cy = (CENTER_Y + Math.sin(a) * r).toFixed(2);
    out += `<circle cx="${cx}" cy="${cy}" r="1.7" fill="${fill}" opacity="0.85"/>`;
  }
  return out;
};

const svgFor = (badge) => {
  const t = TIERS[badge.tier] ?? TIERS.bronze;
  const emoji = xml(badge.icon ?? '🏅');
  const label = xml(`${badge.name} badge`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${label}">
  <defs>
    <radialGradient id="disc" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="${t.light}"/>
      <stop offset="55%" stop-color="${t.mid}"/>
      <stop offset="100%" stop-color="${t.dark}"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.light}"/>
      <stop offset="100%" stop-color="${t.dark}"/>
    </linearGradient>
  </defs>
  <path d="M50 92 L38 122 L51 116 L58 124 L64 96 Z" fill="${t.dark}"/>
  <path d="M78 92 L90 122 L77 116 L70 124 L64 96 Z" fill="${t.mid}"/>
  <circle cx="${CENTER_X}" cy="${CENTER_Y}" r="${RING_R}" fill="url(#ring)" stroke="${t.dark}" stroke-width="1.5"/>
  ${studs(t.stud)}
  <circle cx="${CENTER_X}" cy="${CENTER_Y}" r="${DISC_R}" fill="url(#disc)" stroke="${t.dark}" stroke-width="1.5"/>
  <path d="M${CENTER_X - 27} ${CENTER_Y - 8} A28 28 0 0 1 ${CENTER_X + 27} ${CENTER_Y - 8}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.20"/>
  <text x="${CENTER_X}" y="${CENTER_Y + 1}" font-size="34" text-anchor="middle" dominant-baseline="central" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
</svg>`;
};

const dataUri = (svg) =>
  `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, ' ').trim())}`;

const { badges } = JSON.parse(await readFile(CATALOG, 'utf8'));

await mkdir(SVG_DIR, { recursive: true });

const art = {};
for (const badge of badges) {
  const svg = svgFor(badge);
  await writeFile(join(SVG_DIR, `${badge.id}.svg`), `${svg}\n`);
  art[badge.id] = dataUri(svg);
}

await writeFile(ART_JSON, `${JSON.stringify(art, null, 2)}\n`);

console.log(`Generated ${badges.length} badge SVGs in ui/assets/badges/ and functions/badges/art.json`);
