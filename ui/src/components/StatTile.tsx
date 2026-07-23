import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { StatusBadge, type StatusBadgeTone } from './StatusBadge';
import { TrendPill } from './TrendPill';
import { TrendSparkline } from './TrendSparkline';

export interface StatTileStatus {
  tone: Extract<StatusBadgeTone, 'warning' | 'error'> | StatusBadgeTone;
  label: ReactNode;
}

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  /** Uppercase caption above the value, e.g. "Open Rate". */
  label: ReactNode;
  /** Headline value, e.g. "48.0%". */
  value: ReactNode;
  /** Change vs. the comparison baseline; renders a TrendPill when non-zero. */
  delta?: number;
  /** Set when a falling delta is good (bounce rate, unsubscribes). */
  invertDelta?: boolean;
  deltaPrecision?: number;
  deltaSuffix?: string;
  /** Threshold/health badge shown beside the label. */
  status?: StatTileStatus;
  /** Caption line under the value ("1,234 opens · vs. avg"). */
  meta?: ReactNode;
  /** Decorative icon bubble in the top-right corner. */
  icon?: ReactNode;
  /** Metric history (oldest first) for the footer sparkline. */
  sparkline?: number[];
}

/**
 * Dashboard metric tile: uppercase label, display-font value, and optional
 * delta pill, status badge, caption, icon, and trend sparkline — the shared
 * chrome behind analytics dashboards. Fully composable: children render
 * after the built-in slots for anything bespoke.
 */
export function StatTile({
  label,
  value,
  delta,
  invertDelta,
  deltaPrecision,
  deltaSuffix,
  status,
  meta,
  icon,
  sparkline,
  className,
  children,
  ...rest
}: StatTileProps) {
  return (
    <div className={cx('stat-tile', className)} {...rest}>
      <div className="stat-tile-header">
        <div>
          <div className="stat-tile-label">{label}</div>
          <div className="stat-tile-row">
            <span className="stat-tile-value">{value}</span>
            {delta !== undefined && delta !== 0 && (
              <TrendPill
                delta={delta}
                invert={invertDelta}
                precision={deltaPrecision}
                suffix={deltaSuffix}
              />
            )}
            {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
          </div>
        </div>
        {icon != null && <span className="stat-tile-icon" aria-hidden="true">{icon}</span>}
      </div>
      {meta != null && <div className="stat-tile-meta">{meta}</div>}
      {children}
      {sparkline && sparkline.length >= 2 && (
        <div className="stat-tile-footer">
          <TrendSparkline values={sparkline} />
        </div>
      )}
    </div>
  );
}
