import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type AlertVariant = 'error' | 'success' | 'info';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

export function Alert({ variant = 'info', className, ...rest }: AlertProps) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cx('alert', `alert-${variant}`, className)}
      {...rest}
    />
  );
}
