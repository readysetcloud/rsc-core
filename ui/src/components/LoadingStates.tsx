import type { HTMLAttributes, ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

export type LoadingSize = 'sm' | 'md' | 'lg';
export type ProgressStepStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export interface LoadingSpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: LoadingSize;
}

export function LoadingSpinner({ size = 'md', className, ...rest }: LoadingSpinnerProps) {
  return <Spinner className={cx(`loading-spinner-${size}`, className)} {...rest} />;
}

export interface LoadingProps extends HTMLAttributes<HTMLDivElement> {
  size?: LoadingSize;
  text?: ReactNode;
}

export function Loading({ size = 'md', text, className, ...rest }: LoadingProps) {
  return (
    <div className={cx('loading-state', className)} role="status" aria-live="polite" {...rest}>
      <LoadingSpinner size={size} />
      {text && <span className="loading-state-text">{text}</span>}
    </div>
  );
}

export interface LoadingPageProps extends HTMLAttributes<HTMLDivElement> {
  text?: ReactNode;
}

export function LoadingPage({ text = 'Loading...', className, ...rest }: LoadingPageProps) {
  return (
    <div className={cx('loading-page', className)} {...rest}>
      <Loading size="lg" text={text} />
    </div>
  );
}

export interface InlineLoadingProps extends HTMLAttributes<HTMLDivElement> {
  isLoading: boolean;
  loadingText?: ReactNode;
  children: ReactNode;
  size?: Exclude<LoadingSize, 'lg'>;
}

export function InlineLoading({
  isLoading,
  loadingText,
  children,
  size = 'sm',
  className,
  ...rest
}: InlineLoadingProps) {
  if (!isLoading) {
    return <>{children}</>;
  }

  return (
    <div className={cx('inline-loading', className)} role="status" aria-live="polite" {...rest}>
      <LoadingSpinner size={size} />
      {loadingText && <span>{loadingText}</span>}
    </div>
  );
}

export interface LoadingOverlayProps extends HTMLAttributes<HTMLDivElement> {
  isLoading: boolean;
  message?: ReactNode;
  children: ReactNode;
}

export function LoadingOverlay({
  isLoading,
  message = 'Loading...',
  children,
  className,
  ...rest
}: LoadingOverlayProps) {
  return (
    <div className={cx('loading-overlay-shell', className)} aria-busy={isLoading || undefined} {...rest}>
      {children}
      {isLoading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <LoadingSpinner size="lg" />
          <span className="loading-state-text">{message}</span>
        </div>
      )}
    </div>
  );
}

export interface SkeletonLoaderProps extends HTMLAttributes<HTMLDivElement> {
  count?: number;
}

export function SkeletonLoader({ count = 3, className, ...rest }: SkeletonLoaderProps) {
  return (
    <div className={cx('skeleton-loader', className)} aria-hidden="true" {...rest}>
      {Array.from({ length: count }).map((_, index) => (
        <div className="skeleton-loader-row" key={index}>
          <Skeleton className="skeleton-loader-avatar" />
          <div className="skeleton-loader-copy">
            <Skeleton height="0.875rem" />
            <Skeleton width="66%" height="0.75rem" />
          </div>
          <div className="skeleton-loader-actions">
            <Skeleton width="5rem" height="1.5rem" />
            <Skeleton width="2rem" height="2rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ProgressStep {
  id: string;
  label: ReactNode;
  status: ProgressStepStatus;
  description?: ReactNode;
}

export interface ProgressIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  steps: ProgressStep[];
}

export function ProgressIndicator({ steps, className, ...rest }: ProgressIndicatorProps) {
  return (
    <div className={cx('progress-indicator', className)} {...rest}>
      {steps.map((step) => (
        <div className="progress-step" data-status={step.status} key={step.id}>
          <span className="progress-step-icon" aria-hidden="true" />
          <div className="progress-step-copy">
            <span className="progress-step-label">{step.label}</span>
            {step.description && <span className="progress-step-description">{step.description}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  heading?: ReactNode;
  message: ReactNode;
  action?: {
    label: ReactNode;
    onClick: () => void;
  };
}

export function ErrorState({ heading = 'Something went wrong', message, action, className, ...rest }: ErrorStateProps) {
  return (
    <Alert variant="error" className={cx('error-state', className)} {...rest}>
      <div className="error-state-copy">
        <strong>{heading}</strong>
        <span>{message}</span>
      </div>
      {action && (
        <Button type="button" variant="error" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Alert>
  );
}
