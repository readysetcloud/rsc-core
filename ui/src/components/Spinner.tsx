import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export function Spinner({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('spinner', className)} aria-hidden="true" {...rest} />;
}
