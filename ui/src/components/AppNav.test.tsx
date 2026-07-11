/* Tests for the React AppNav side (vertical) layout: grouped sections, per-item
   icons, and that the default top layout stays flat. The vanilla build has its
   own parity tests in nav-browser.test.ts. */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNav, type AppNavItem } from './AppNav';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

const sideItems: AppNavItem[] = [
  { id: '/', label: 'Dashboard', href: '/', active: true, icon: <svg data-testid="home" /> },
  { id: '/issues', label: 'Issues', href: '/issues', section: 'Publish' },
  { id: '/subscribers', label: 'Subscribers', href: '/subscribers', section: 'Publish' },
  { id: '/posts', label: 'Posts', href: '/posts', section: 'Content' },
  { id: '/brand', label: 'Brand', href: '/brand' }
];

describe('AppNav side layout', () => {
  it('adds app-nav-side and groups consecutive sections, preserving order', () => {
    const { container } = render(<AppNav appName="Outboxed" layout="side" navItems={sideItems} />);

    expect(container.querySelector('.app-nav')?.classList.contains('app-nav-side')).toBe(true);

    const sections = [...container.querySelectorAll('.app-nav-section')];
    expect(sections).toHaveLength(4);
    const titles = sections.map((s) => s.querySelector('.app-nav-section-title')?.textContent ?? null);
    expect(titles).toEqual([null, 'Publish', 'Content', null]);

    const publishLinks = [...sections[1]!.querySelectorAll('.app-nav-link')].map((l) => l.textContent);
    expect(publishLinks).toEqual(['Issues', 'Subscribers']);
  });

  it('renders the per-item icon and marks the active item with aria-current', () => {
    const { container } = render(<AppNav appName="Outboxed" layout="side" navItems={sideItems} />);
    const active = container.querySelector('.app-nav-link-active') as HTMLElement;
    expect(active.textContent).toBe('Dashboard');
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.querySelector('.app-nav-link-icon svg[data-testid="home"]')).toBeTruthy();
  });

  it('stays flat with no sections in the default top layout', () => {
    const { container } = render(<AppNav appName="RSC" navItems={sideItems} />);
    expect(container.querySelector('.app-nav')?.classList.contains('app-nav-side')).toBe(false);
    expect(container.querySelector('.app-nav-section')).toBeNull();
    expect([...container.querySelectorAll('.app-nav-link')].map((l) => l.textContent)).toEqual([
      'Dashboard',
      'Issues',
      'Subscribers',
      'Posts',
      'Brand'
    ]);
  });
});
