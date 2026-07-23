import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type PageHeroChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

/**
 * Gradient hero band that opens a page: surface-to-primary wash with a soft
 * accent blob (drawn in CSS), display-font title, and pill meta chips.
 */
export function PageHero({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <header className={cx('page-hero', className)} {...rest}>
      <div className="page-hero-content">{children}</div>
    </header>
  );
}

export function PageHeroTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cx('page-hero-title', className)} {...rest} />;
}

export function PageHeroSubtitle({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('page-hero-subtitle', className)} {...rest} />;
}

export function PageHeroChips({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('page-hero-chips', className)} {...rest} />;
}

export interface PageHeroChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PageHeroChipTone;
  /** Optional leading icon; rendered aria-hidden. */
  icon?: ReactNode;
}

export function PageHeroChip({ tone = 'neutral', icon, className, children, ...rest }: PageHeroChipProps) {
  return (
    <span
      className={cx('page-hero-chip', tone !== 'neutral' && `page-hero-chip-${tone}`, className)}
      {...rest}
    >
      {icon != null && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
