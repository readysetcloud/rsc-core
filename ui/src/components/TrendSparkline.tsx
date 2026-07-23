import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import {
  SPARKLINE_VIEWBOX_HEIGHT,
  SPARKLINE_VIEWBOX_WIDTH,
  sparklineGeometry
} from './sparkline';

export interface TrendSparklineProps extends HTMLAttributes<HTMLDivElement> {
  /** Metric history, oldest first. Needs at least two points to render. */
  values: number[];
}

/**
 * Decorative trend line for a metric across recent periods, with the latest
 * point emphasized. The values are surfaced as text elsewhere (e.g. in the
 * StatTile), so the whole drawing is aria-hidden.
 */
export function TrendSparkline({ values, className, ...rest }: TrendSparklineProps) {
  const geometry = sparklineGeometry(values);

  if (!geometry) return null;

  return (
    <div className={cx('sparkline', className)} aria-hidden="true" {...rest}>
      <svg
        viewBox={`0 0 ${SPARKLINE_VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <path d={geometry.area} fill="currentColor" opacity={0.12} />
        <polyline
          points={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="sparkline-dot"
        style={{
          left: `${geometry.last.x}%`,
          top: `${(geometry.last.y / SPARKLINE_VIEWBOX_HEIGHT) * 100}%`
        }}
      />
    </div>
  );
}
