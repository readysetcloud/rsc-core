import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHero, PageHeroChip, PageHeroChips, PageHeroTitle } from './PageHero';
import { SegmentedControl } from './SegmentedControl';
import { StatTile } from './StatTile';
import { StatusBadge } from './StatusBadge';
import { TrendPill } from './TrendPill';
import { TrendSparkline } from './TrendSparkline';
import { renderSparkline, sparklineGeometry } from './sparkline';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders the tone class and label', () => {
    render(<StatusBadge tone="success">Stable</StatusBadge>);

    const badge = screen.getByRole('status');
    expect(badge.className).toContain('status-badge-success');
    expect(badge.textContent).toContain('Stable');
  });

  it('hides the icon from assistive tech', () => {
    render(<StatusBadge tone="warning" icon="⚠">High</StatusBadge>);

    const icon = screen.getByText('⚠');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TrendPill', () => {
  it('renders an improvement as positive with a plus sign', () => {
    render(<TrendPill delta={6.3} />);

    const pill = screen.getByRole('status');
    expect(pill.className).toContain('trend-pill-positive');
    expect(pill.textContent).toContain('+6.3%');
  });

  it('treats a falling inverted metric as an improvement', () => {
    render(<TrendPill delta={-0.4} invert />);

    const pill = screen.getByRole('status');
    expect(pill.className).toContain('trend-pill-positive');
    expect(pill.textContent).toContain('-0.4%');
  });

  it('treats a rising inverted metric as a decline', () => {
    render(<TrendPill delta={2.1} invert />);

    expect(screen.getByRole('status').className).toContain('trend-pill-negative');
  });

  it('renders a zero delta as neutral with no arrow', () => {
    const { container } = render(<TrendPill delta={0} />);

    expect(screen.getByRole('status').className).toContain('trend-pill-neutral');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'average', label: 'Average' },
    { value: 'last', label: 'Last issue' },
    { value: 'best', label: 'Best issue' }
  ];

  it('marks the active option pressed and fires onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Comparison baseline"
        options={options}
        value="average"
        onChange={onChange}
      />
    );

    const group = screen.getByRole('group', { name: 'Comparison baseline' });
    expect(group.className).toContain('segmented-control');

    const active = screen.getByRole('button', { name: 'Average' });
    expect(active.getAttribute('aria-pressed')).toBe('true');

    const last = screen.getByRole('button', { name: 'Last issue' });
    expect(last.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(last);
    expect(onChange).toHaveBeenCalledWith('last');
  });

  it('respects disabled options', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="View"
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }]}
        value="a"
        onChange={onChange}
      />
    );

    const disabled = screen.getByRole('button', { name: 'B' });
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TrendSparkline', () => {
  it('renders nothing with fewer than two points', () => {
    const { container } = render(<TrendSparkline values={[42]} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders an aria-hidden drawing with an emphasized last point', () => {
    const { container } = render(<TrendSparkline values={[1, 3, 2, 5]} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('sparkline');
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.querySelector('polyline')).not.toBeNull();

    const dot = wrapper.querySelector('.sparkline-dot') as HTMLElement;
    expect(dot.style.left).toBe('100%');
  });
});

describe('sparkline core', () => {
  it('returns null for fewer than two points', () => {
    expect(sparklineGeometry([])).toBeNull();
    expect(sparklineGeometry([1])).toBeNull();
  });

  it('maps values onto the viewBox with the last point at x=100', () => {
    const geometry = sparklineGeometry([0, 10]);
    expect(geometry).not.toBeNull();
    expect(geometry!.last.x).toBe(100);
    expect(geometry!.last.y).toBe(3); // max value sits at the top padding
  });

  it('centers a flat series vertically', () => {
    const geometry = sparklineGeometry([5, 5, 5]);
    expect(geometry!.last.y).toBe(14);
  });

  it('renders the same drawing without React', () => {
    const host = document.createElement('div');
    renderSparkline(host, [1, 2, 3]);

    expect(host.className).toContain('sparkline');
    expect(host.querySelector('polyline')).not.toBeNull();
    expect(host.querySelector('.sparkline-dot')).not.toBeNull();

    renderSparkline(host, [1]);
    expect(host.querySelector('svg')).toBeNull();
  });
});

describe('StatTile', () => {
  it('renders label, value, delta pill, status badge, meta, and sparkline', () => {
    const { container } = render(
      <StatTile
        label="Bounce Rate"
        value="1.3%"
        delta={-0.4}
        invertDelta
        status={{ tone: 'warning', label: 'High' }}
        meta="67 bounces · vs. avg"
        sparkline={[2, 1.8, 1.5, 1.3]}
      />
    );

    expect(screen.getByText('Bounce Rate')).toBeDefined();
    expect(screen.getByText('1.3%')).toBeDefined();
    expect(screen.getByText('High')).toBeDefined();
    expect(screen.getByText('67 bounces · vs. avg')).toBeDefined();
    expect(container.querySelector('.trend-pill-positive')).not.toBeNull();
    expect(container.querySelector('.sparkline')).not.toBeNull();
  });

  it('omits the pill for a zero delta and the sparkline for short series', () => {
    const { container } = render(<StatTile label="Opens" value="1,234" delta={0} sparkline={[1]} />);

    expect(container.querySelector('.trend-pill')).toBeNull();
    expect(container.querySelector('.sparkline')).toBeNull();
  });
});

describe('PageHero', () => {
  it('renders a header band with title and toned chips', () => {
    render(
      <PageHero>
        <PageHeroTitle>Serverless Picks of the Week</PageHeroTitle>
        <PageHeroChips>
          <PageHeroChip>Issue #204</PageHeroChip>
          <PageHeroChip tone="success">Sent Jul 21</PageHeroChip>
        </PageHeroChips>
      </PageHero>
    );

    const title = screen.getByRole('heading', { level: 1, name: 'Serverless Picks of the Week' });
    expect(title.className).toContain('page-hero-title');

    const sent = screen.getByText('Sent Jul 21');
    expect(sent.className).toContain('page-hero-chip-success');
    expect(screen.getByText('Issue #204').className).not.toContain('page-hero-chip-neutral');
  });
});
