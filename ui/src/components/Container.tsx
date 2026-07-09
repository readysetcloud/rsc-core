import type { HTMLAttributes } from 'react';
import { cx } from './cx';

/** Responsive page container: max 72rem, fluid inline padding. */
export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('container-rsc', className)} {...rest} />;
}
