import type { ReactNode } from 'react';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import type { EarnedBadge, InProgressBadge, NextLevel } from '../badges/types';

export interface BadgeChestProps {
  /** Total points earned across every app. */
  points: number;
  /** Current level number. */
  level: number;
  /** Current level name, e.g. "Cloud Builder". */
  levelName?: string;
  /** Point floor of the current level (from the chest API). */
  levelMinPoints?: number;
  /** The level the user is working toward, or null at max level. */
  nextLevel?: NextLevel | null;
  /** Unlocked badges. */
  badges: EarnedBadge[];
  /** Badges the user is progressing toward. */
  inProgress?: InProgressBadge[];
  /** Hide the "in progress" section. Defaults to showing it. */
  showInProgress?: boolean;
  /** Render skeletons instead of content while the chest loads. */
  loading?: boolean;
  /** Shown when the user has earned no badges yet. */
  emptyState?: ReactNode;
  /** Heading text. Defaults to "Badge Chest". */
  title?: ReactNode;
  className?: string;
}

const tierClass = (tier?: string) => (tier ? `badge-tile--${tier}` : 'badge-tile--bronze');

/**
 * The shared cross-app trophy case. Renders a user's level, point total,
 * progress to the next level, unlocked badges, and (optionally) badges in
 * progress. Presentational — fetch the data with `createBadgeClient` and pass
 * it in, so every app renders the chest identically.
 */
export function BadgeChest({
  points,
  level,
  levelName,
  levelMinPoints = 0,
  nextLevel,
  badges,
  inProgress = [],
  showInProgress = true,
  loading = false,
  emptyState,
  title = 'Badge Chest',
  className
}: BadgeChestProps) {
  const pct = nextLevel
    ? Math.max(0, Math.min(100, ((points - levelMinPoints) / (nextLevel.minPoints - levelMinPoints)) * 100))
    : 100;

  return (
    <section className={cx('card', 'badge-chest', className)} aria-label="Badge chest">
      <header className="badge-chest-header">
        <div className="badge-chest-heading">
          <span className="badge-chest-title">{title}</span>
          <span className="badge-chest-level">
            Lv.{level}
            {levelName ? ` · ${levelName}` : ''}
          </span>
        </div>
        <div className="badge-chest-points">
          <strong>{points.toLocaleString()}</strong> pts
        </div>
        <div
          className="badge-chest-progress"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="badge-chest-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="badge-chest-next">
          {nextLevel
            ? `${nextLevel.pointsToGo.toLocaleString()} pts to ${nextLevel.name}`
            : 'Max level reached'}
        </p>
      </header>

      <div className="badge-chest-body">
        {loading ? (
          <div className="badge-chest-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height="6.5rem" />
            ))}
          </div>
        ) : badges.length === 0 && (!showInProgress || inProgress.length === 0) ? (
          emptyState ?? (
            <p className="badge-chest-empty">No badges yet — go earn your first one!</p>
          )
        ) : (
          <>
            {badges.length > 0 && (
              <div className="badge-chest-grid">
                {badges.map((badge) => (
                  <EarnedTile key={badge.id} badge={badge} />
                ))}
              </div>
            )}

            {showInProgress && inProgress.length > 0 && (
              <>
                <h4 className="badge-chest-section">In progress</h4>
                <div className="badge-chest-grid">
                  {inProgress.map((badge) => (
                    <LockedTile key={badge.id} badge={badge} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EarnedTile({ badge }: { badge: EarnedBadge }) {
  return (
    <div className={cx('badge-tile', tierClass(badge.tier))} title={badge.description}>
      <span className="badge-tile-icon" aria-hidden="true">
        {badge.icon ?? '🏅'}
      </span>
      <span className="badge-tile-name">{badge.name}</span>
      <span className="badge-tile-points">+{badge.points}</span>
    </div>
  );
}

function LockedTile({ badge }: { badge: InProgressBadge }) {
  const pct = badge.threshold > 0 ? Math.min(100, (badge.current / badge.threshold) * 100) : 0;
  return (
    <div className="badge-tile badge-tile--locked" title={badge.description}>
      <span className="badge-tile-icon" aria-hidden="true">
        {badge.icon ?? '🔒'}
      </span>
      <span className="badge-tile-name">{badge.name}</span>
      <div className="badge-tile-progress" aria-hidden="true">
        <span className="badge-tile-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="badge-tile-points">
        {badge.current}/{badge.threshold}
      </span>
    </div>
  );
}
