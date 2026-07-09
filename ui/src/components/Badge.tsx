import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type BadgeVariant = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cx('badge', `badge-${variant}`, className)} {...rest} />;
}
