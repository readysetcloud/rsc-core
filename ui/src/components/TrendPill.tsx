import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface TrendPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** The change being described, e.g. +6.3 for a 6.3-point improvement. */
  delta: number;
  /** Set when a falling metric is good (bounce rate, unsubscribes, errors). */
  invert?: boolean;
  /** Decimal places for the default label. */
  precision?: number;
  /** Suffix appended to the default label. */
  suffix?: string;
}

const ARROW_UP = 'M3 10.5 8 5.5 13 10.5';
const ARROW_DOWN = 'M3 5.5 8 10.5 13 5.5';

/**
 * Colored delta chip rendered next to a metric value ("+6.3% ↗"). Color
 * encodes whether the change is an improvement — pass `invert` for metrics
 * where down is good. A zero delta renders the neutral pill with no arrow.
 * Children override the default formatted label.
 */
export function TrendPill({
  delta,
  invert = false,
  precision = 1,
  suffix = '%',
  className,
  children,
  ...rest
}: TrendPillProps) {
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral';
  const sentiment =
    direction === 'neutral' ? 'neutral' : (delta > 0) !== invert ? 'positive' : 'negative';
  const label = children ?? `${delta > 0 ? '+' : ''}${delta.toFixed(precision)}${suffix}`;

  return (
    <span
      className={cx('trend-pill', `trend-pill-${sentiment}`, className)}
      role="status"
      aria-label={
        direction === 'neutral'
          ? 'No change'
          : `Trend ${sentiment === 'positive' ? 'improving' : 'declining'}: ${label}`
      }
      {...rest}
    >
      {direction !== 'neutral' && (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={direction === 'up' ? ARROW_UP : ARROW_DOWN}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {label}
    </span>
  );
}
