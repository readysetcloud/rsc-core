import { BADGES, LEVELS, CATALOG_VERSION, toPublicBadge } from './utils/badges.mjs';

/**
 * Public catalog of every badge that can be earned plus the level ladder. Apps
 * use this to render "here's what you can unlock" and to look up badge metadata
 * for badges a user hasn't earned yet. No auth required — it's static reference
 * data with no user context.
 */
export const handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
  },
  body: JSON.stringify({
    version: CATALOG_VERSION,
    badges: BADGES.map(toPublicBadge),
    levels: LEVELS
  })
});
