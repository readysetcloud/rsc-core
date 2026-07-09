import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from './cx';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}

export function Skeleton({ width = '100%', height = '1rem', className, style, ...rest }: SkeletonProps) {
  return (
    <div
      className={cx('skeleton', className)}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
