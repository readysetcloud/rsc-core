import catalog from '../badges/catalog.json';
import levels from '../badges/levels.json';

/**
 * Shared badge/gamification logic for the RSC "badge chest".
 *
 * This module owns the pure rules: the badge catalog, how a raw activity
 * metric maps to the badges that care about it, whether a badge's criteria are
 * met given the user's current counters, and how total points roll up into a
 * level. It has no AWS dependencies so it can be unit tested and reused by any
 * function that needs to reason about badges.
 */

export const CATALOG_VERSION = catalog.version;
export const BADGES = catalog.badges;
export const LEVELS = [...levels.levels].sort((a, b) => a.minPoints - b.minPoints);

const BADGES_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

// metric -> badges whose criteria are driven by that metric. Built once so the
// activity processor only evaluates the handful of badges an event can affect.
const BADGES_BY_METRIC = (() => {
  const index = new Map();
  for (const badge of BADGES) {
    const metric = badge.criteria?.metric;
    if (!metric) continue;
    if (!index.has(metric)) index.set(metric, []);
    index.get(metric).push(badge);
  }
  return index;
})();

// Meta badges are re-evaluated whenever any of their dependency badges is earned.
export const META_BADGES = BADGES.filter((b) => b.criteria?.type === 'meta');

export const getBadge = (id) => BADGES_BY_ID.get(id);
export const getBadgesForMetric = (metric) => BADGES_BY_METRIC.get(metric) ?? [];

/**
 * The set of DynamoDB counter keys a single activity event should increment.
 * We always keep an ecosystem-wide counter and, when the activity names a
 * service, a per-service counter, so both ecosystem and service-scoped badges
 * can be satisfied from the same event.
 *
 * @returns {{ metric: string, unique: boolean, scoped: boolean, service?: string }[]}
 */
export const getCountersForActivity = (action, service) => {
  const badges = getBadgesForMetric(action);
  if (!badges.length) return [];

  const wantsUnique = badges.some((b) => b.criteria.type === 'unique');
  const wantsScoped = badges.some((b) => b.criteria.type === 'count' && b.criteria.service);

  const counters = [{ metric: action, unique: wantsUnique, scoped: false }];
  if (wantsScoped && service) {
    counters.push({ metric: action, unique: false, scoped: true, service });
  }
  return counters;
};

/** DynamoDB sort key for a progress counter. */
export const counterKey = ({ metric, unique, scoped, service }) => {
  if (unique) return `unique#${metric}`;
  if (scoped) return `progress#${service}#${metric}`;
  return `progress#${metric}`;
};

/**
 * Evaluate a badge's criteria against the user's current state.
 *
 * @param badge      the catalog badge definition
 * @param counters   map of counterKey -> numeric value (progress counters / unique-set sizes)
 * @param earnedIds  Set of badge ids the user has already earned (for meta badges)
 */
export const isEarned = (badge, counters, earnedIds) => {
  const c = badge.criteria;
  if (!c) return false;

  switch (c.type) {
    case 'count': {
      const key = c.service
        ? `progress#${c.service}#${c.metric}`
        : `progress#${c.metric}`;
      return (counters[key] ?? 0) >= c.threshold;
    }
    case 'unique': {
      return (counters[`unique#${c.metric}`] ?? 0) >= c.threshold;
    }
    case 'meta': {
      const have = c.badges.filter((id) => earnedIds.has(id)).length;
      return have >= (c.threshold ?? c.badges.length);
    }
    default:
      return false;
  }
};

/** Resolve a total point count to its level definition. */
export const computeLevel = (points) => {
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (points >= level.minPoints) current = level;
    else break;
  }
  return current;
};

/** The next level a user is working toward, plus how many points remain (null at max). */
export const getNextLevel = (points) => {
  const next = LEVELS.find((l) => l.minPoints > points);
  if (!next) return null;
  return { ...next, pointsToGo: next.minPoints - points };
};

/** Public-facing view of a badge definition (hides internal criteria wiring). */
export const toPublicBadge = (badge) => ({
  id: badge.id,
  name: badge.name,
  description: badge.description,
  icon: badge.icon,
  category: badge.category,
  tier: badge.tier,
  points: badge.points,
  ...(badge.service && { service: badge.service })
});
