import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BadgeChest } from './BadgeChest';
import type { EarnedBadge, InProgressBadge } from '../badges/types';

afterEach(cleanup);

const earned: EarnedBadge[] = [
  { id: 'welcome', name: 'Welcome Aboard', icon: '🎉', tier: 'bronze', points: 10 }
];
const inProgress: InProgressBadge[] = [
  { id: 'explorer', name: 'Ecosystem Explorer', icon: '🧭', tier: 'gold', points: 100, current: 2, threshold: 5 }
];

describe('BadgeChest', () => {
  it('renders level, points, and earned badges', () => {
    render(
      <BadgeChest
        points={60}
        level={2}
        levelName="Cloud Explorer"
        levelMinPoints={50}
        nextLevel={{ level: 3, name: 'Cloud Builder', minPoints: 150, pointsToGo: 90 }}
        badges={earned}
        inProgress={inProgress}
      />
    );

    expect(screen.getByText('Welcome Aboard')).toBeDefined();
    expect(screen.getByText('60')).toBeDefined();
    expect(screen.getByText(/Cloud Explorer/)).toBeDefined();
    expect(screen.getByText(/90 pts to Cloud Builder/)).toBeDefined();
    expect(screen.getByText('Ecosystem Explorer')).toBeDefined();
    expect(screen.getByText('2/5')).toBeDefined();
  });

  it('fills the progress bar based on points within the level band', () => {
    render(
      <BadgeChest
        points={100}
        level={2}
        levelMinPoints={50}
        nextLevel={{ level: 3, name: 'Cloud Builder', minPoints: 150, pointsToGo: 50 }}
        badges={earned}
      />
    );

    // (100 - 50) / (150 - 50) = 50%
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('renders SVG artwork when a badge has an iconUrl, and the emoji otherwise', () => {
    const { container } = render(
      <BadgeChest
        points={30}
        level={1}
        badges={[
          { id: 'art', name: 'With Art', iconUrl: 'data:image/svg+xml,<svg/>', tier: 'gold', points: 20 },
          { id: 'plain', name: 'No Art', icon: '🎉', tier: 'bronze', points: 10 }
        ]}
        inProgress={[]}
      />
    );

    const art = container.querySelector('img.badge-tile-art');
    expect(art?.getAttribute('src')).toBe('data:image/svg+xml,<svg/>');
    // The emoji badge keeps the text fallback rather than an <img>.
    expect(container.querySelectorAll('img.badge-tile-art')).toHaveLength(1);
    expect(screen.getByText('🎉')).toBeDefined();
  });

  it('shows the empty state when nothing is earned or in progress', () => {
    render(<BadgeChest points={0} level={1} badges={[]} inProgress={[]} />);
    expect(screen.getByText(/go earn your first one/i)).toBeDefined();
  });

  it('reports max level when there is no next level', () => {
    render(<BadgeChest points={700} level={5} levelName="Cloud Sage" nextLevel={null} badges={earned} />);
    expect(screen.getByText(/Max level reached/)).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
