import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type StatusBadgeTone = 'success' | 'warning' | 'error' | 'primary' | 'neutral';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusBadgeTone;
  /** Optional leading icon; rendered aria-hidden — the label carries meaning. */
  icon?: ReactNode;
}

/**
 * Sentence-case health/state pill (e.g. "✓ Stable", "High"). The tone ramps
 * auto-invert in dark mode, so one tone renders correctly in both themes.
 * For the uppercase mono tag, use Badge instead.
 */
export function StatusBadge({ tone = 'neutral', icon, className, children, ...rest }: StatusBadgeProps) {
  return (
    <span className={cx('status-badge', `status-badge-${tone}`, className)} role="status" {...rest}>
      {icon != null && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
