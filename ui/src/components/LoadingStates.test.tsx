import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorState,
  InlineLoading,
  Loading,
  LoadingOverlay,
  LoadingPage,
  ProgressIndicator,
  SkeletonLoader
} from './LoadingStates';

afterEach(cleanup);

describe('LoadingStates', () => {
  it('renders accessible loading copy', () => {
    render(<Loading text="Loading subscribers..." />);

    expect(screen.getByRole('status').textContent).toContain('Loading subscribers...');
  });

  it('renders page loading with default copy', () => {
    render(<LoadingPage />);

    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('swaps inline children for loading content', () => {
    const { rerender } = render(
      <InlineLoading isLoading={false} loadingText="Saving">
        <span>Ready</span>
      </InlineLoading>
    );

    expect(screen.getByText('Ready')).toBeDefined();

    rerender(
      <InlineLoading isLoading loadingText="Saving">
        <span>Ready</span>
      </InlineLoading>
    );

    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Saving');
  });

  it('overlays children only while loading', () => {
    const { rerender } = render(
      <LoadingOverlay isLoading={false} message="Loading senders">
        <section>Sender form</section>
      </LoadingOverlay>
    );

    expect(screen.getByText('Sender form')).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();

    rerender(
      <LoadingOverlay isLoading message="Loading senders">
        <section>Sender form</section>
      </LoadingOverlay>
    );

    expect(screen.getByRole('status').textContent).toContain('Loading senders');
  });

  it('renders the requested number of skeleton rows', () => {
    const { container } = render(<SkeletonLoader count={2} />);

    expect(container.querySelectorAll('.skeleton-loader-row')).toHaveLength(2);
  });

  it('renders progress steps with status attributes', () => {
    const { container } = render(
      <ProgressIndicator
        steps={[
          { id: 'dns', label: 'DNS records', status: 'completed' },
          { id: 'verify', label: 'Verify domain', status: 'in-progress', description: 'This can take a while.' },
          { id: 'send', label: 'Send email', status: 'pending' }
        ]}
      />
    );

    expect(screen.getByText('DNS records')).toBeDefined();
    expect(screen.getByText('This can take a while.')).toBeDefined();
    expect(container.querySelector("[data-status='in-progress']")).toBeDefined();
  });

  it('renders retryable error state actions', () => {
    const onRetry = vi.fn();

    render(<ErrorState message="Could not load templates." action={{ label: 'Retry', onClick: onRetry }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('alert').textContent).toContain('Could not load templates.');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
