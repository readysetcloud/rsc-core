/* Tests for the React AppNav side (vertical) layout: grouped sections, per-item
   icons, and that the default top layout stays flat. The vanilla build has its
   own parity tests in nav-browser.test.ts. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNav, type AppNavItem, type AppNavLinkProps } from './AppNav';

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

  it('routes in-app links through linkComponent but leaves external links as anchors', () => {
    const seen: string[] = [];
    // A stand-in for a router Link: records the target and marks itself so the
    // test can tell it apart from a plain anchor.
    const RouterLink = ({ href, children, ...rest }: AppNavLinkProps) => {
      seen.push(href);
      return (
        <a data-router="1" href={href} {...rest}>
          {children}
        </a>
      );
    };

    const { container } = render(
      <AppNav
        appName="Outboxed"
        layout="side"
        linkComponent={RouterLink}
        primaryAction={{ label: 'New issue', href: '/issues/new' }}
        navItems={[
          { id: '/', label: 'Dashboard', href: '/', active: true },
          { id: 'blog', label: 'Blog', href: 'https://readysetcloud.io', external: true }
        ]}
      />
    );

    // Brand, internal nav item, and primary action go through the router link.
    expect(seen).toContain('/');
    expect(seen).toContain('/issues/new');

    const internal = container.querySelector('.app-nav-link[href="/"]') as HTMLElement;
    expect(internal.getAttribute('data-router')).toBe('1');
    expect(internal.getAttribute('aria-current')).toBe('page');

    // The external link stays a real anchor (target/rel), not a router link.
    const external = container.querySelector('.app-nav-link[href="https://readysetcloud.io"]') as HTMLElement;
    expect(external.getAttribute('data-router')).toBeNull();
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noreferrer');
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

  it('shows item badges with their screen-reader label, none for zero, and a dot on the menu button', () => {
    const { container, rerender } = render(
      <AppNav
        appName="Fantasy"
        layout="side"
        navItems={[
          { id: 'trades', label: 'Trades', href: '/trades', badge: 2, badgeLabel: '2 offers waiting', badgeTone: 'error' },
          { id: 'chat', label: 'Chat', href: '/chat', badge: '99+' },
          { id: 'home', label: 'Home', href: '/home', badge: 0 }
        ]}
      />
    );
    const trades = screen.getByRole('link', { name: 'Trades 2 offers waiting' });
    const badge = trades.querySelector('.app-nav-link-badge-error') as HTMLElement;
    expect(badge.textContent).toBe('22 offers waiting');
    expect(badge.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: 'Chat 99+' }).querySelector('.app-nav-link-badge-primary')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' }).querySelector('.app-nav-link-badge')).toBeNull();
    expect(container.querySelector('.app-nav-menu-btn')?.classList.contains('app-nav-menu-btn-badged')).toBe(true);

    rerender(<AppNav appName="Fantasy" navItems={[{ id: 'home', label: 'Home', href: '/home', badge: '' }]} />);
    expect(container.querySelector('.app-nav-link-badge')).toBeNull();
    expect(container.querySelector('.app-nav-menu-btn')?.classList.contains('app-nav-menu-btn-badged')).toBe(false);
  });

  it('closes the phone menu when a nav link is followed', () => {
    const { container } = render(
      <AppNav appName="Fantasy" layout="side" navItems={[{ id: 'home', label: 'Home', href: '#home' }]} />
    );
    const menu = screen.getByRole('button', { name: 'Toggle navigation' });
    fireEvent.click(menu);
    expect(container.querySelector('.app-nav-collapse-open')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(container.querySelector('.app-nav-collapse-open')).toBeNull();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the phone menu on an outside click only when closeMenuOnOutsideClick is set', () => {
    const items = [{ id: 'home', label: 'Home', href: '#home' }];
    const { container, rerender } = render(<AppNav appName="Fantasy" navItems={items} />);
    const menu = screen.getByRole('button', { name: 'Toggle navigation' });
    fireEvent.click(menu);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('.app-nav-collapse-open')).toBeTruthy();

    rerender(<AppNav appName="Fantasy" navItems={items} closeMenuOnOutsideClick />);
    fireEvent.pointerDown(container.querySelector('.app-nav-collapse')!);
    expect(container.querySelector('.app-nav-collapse-open')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('.app-nav-collapse-open')).toBeNull();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('treats taps inside its own dialogs as inside the nav', () => {
    const { container } = render(
      <AppNav appName="Fantasy" authState="authenticated" user={{ email: 'a@b.co' }} services={[]} closeMenuOnOutsideClick />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    fireEvent.pointerDown(document.body.querySelector('.profile-menu-modal .app-nav-sign-out-action')!);
    expect(container.querySelector('.app-nav-collapse-open')).toBeTruthy();
  });
});
