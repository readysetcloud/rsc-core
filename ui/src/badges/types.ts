// Shared types for the cross-app badge chest. These mirror the JSON returned by
// the rsc-core Badge Chest API (get-badge-chest / get-badge-catalog).

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** A badge definition as it appears in the public catalog. */
export interface BadgeDefinition {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  tier?: BadgeTier;
  points: number;
  /** The app this badge belongs to, if it is service-specific. */
  service?: string;
}

/** A badge the user has unlocked. */
export interface EarnedBadge extends BadgeDefinition {
  /** ISO timestamp the badge was awarded. */
  earnedDate?: string;
}

/** A badge the user is progressing toward but has not unlocked. */
export interface InProgressBadge extends BadgeDefinition {
  current: number;
  threshold: number;
}

export interface LevelDefinition {
  level: number;
  name: string;
  minPoints: number;
}

export interface NextLevel extends LevelDefinition {
  /** Points remaining until this level is reached. */
  pointsToGo: number;
}

/** The full response from GET /badges/me. */
export interface BadgeChestData {
  points: number;
  level: number;
  levelName?: string;
  /** Point floor of the current level — used to draw the progress bar. */
  levelMinPoints?: number;
  nextLevel?: NextLevel | null;
  badgeCount: number;
  badges: EarnedBadge[];
  inProgress: InProgressBadge[];
}

/** The full response from GET /badges/catalog. */
export interface BadgeCatalog {
  version: number;
  badges: BadgeDefinition[];
  levels: LevelDefinition[];
}

/** Payload for recording an activity via POST /badges/activity. */
export interface ActivityInput {
  /** The metric name, e.g. "lesson.completed" or "service.visited". */
  action: string;
  /** How much to increment by (default 1). */
  count?: number;
  /** Distinct dimension value for "unique" badges (e.g. a service id). */
  value?: string;
  /** The app emitting the activity. */
  service?: string;
  /** Idempotency key — reuse across retries to avoid double counting. */
  id?: string;
}
