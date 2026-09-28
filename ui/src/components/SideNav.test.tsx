/* Tests for SideNav: sections, icons, badges, nested groups, the active item,
   the collapsible desktop rail, and the phone drawer (driven by a stubbed
   matchMedia, since jsdom has none). */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { AppNavLinkProps } from './AppNav';
import { SIDE_NAV_PHONE_QUERY, SideNav, SideNavLayout, type SideNavItem } from './SideNav';

let phone = false;
const listeners = new Set<() => void>();

function setPhone(next: boolean) {
  phone = next;
  act(() => listeners.forEach((l) => l()));
}

beforeEach(() => {
  phone = false;
  listeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query === SIDE_NAV_PHONE_QUERY && phone;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l)
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

const items: SideNavItem[] = [
  { id: 'home', label: 'Home', href: '/home', icon: <svg data-testid="home-icon" /> },
  {
    id: 'team',
    label: 'My Team',
    href: '/team',
    icon: <svg />,
    badge: 2,
    badgeLabel: '2 offers waiting',
    items: [
      { id: 'lineup', label: 'Lineup', href: '/team/lineup', active: true },
      { id: 'trades', label: 'Trades', href: '/team/trades', badge: 2, badgeTone: 'error' },
      { id: 'hidden', label: 'Hidden', href: '/team/hidden', visible: false }
    ]
  },
  {
    id: 'league',
    label: 'League',
    items: [
      { id: 'scoreboard', label: 'Scoreboard', href: '/league/scoreboard' },
      { id: 'standings', label: 'Standings', href: '/league/standings' }
    ]
  },
  { id: 'chat', label: 'Chat', href: '/chat', badge: 0, section: 'Talk' },
  { id: 'settings', label: 'Settings', href: '/settings', section: 'Talk' }
];

const nav = () => screen.getByRole('navigation', { name: 'League' });

describe('SideNav', () => {
  it('renders items with icons, grouped sections, and hides invisible ones', () => {
    const { container } = render(<SideNav aria-label="League" items={items} />);
    expect(within(nav()).getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByTestId('home-icon').closest('.side-nav-icon')?.getAttribute('aria-hidden')).toBe('true');
    const titles = [...container.querySelectorAll('.side-nav-section-title')].map((t) => t.textContent);
    expect(titles).toEqual(['Talk']);
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('marks the active item and opens the group that holds it', () => {
    render(<SideNav aria-label="League" items={items} />);
    const lineup = within(nav()).getByRole('link', { name: 'Lineup' });
    expect(lineup.getAttribute('aria-current')).toBe('page');
    expect(lineup.classList.contains('side-nav-link-active')).toBe(true);
    // My Team holds it: open, and its own link reads as "within" rather than current.
    const toggle = screen.getByRole('button', { name: 'Collapse My Team' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const team = within(nav()).getByRole('link', { name: /^My Team/ });
    expect(team.getAttribute('aria-current')).toBeNull();
    expect(team.classList.contains('side-nav-link-within')).toBe(true);
    // League holds nothing active: closed, and its row is one button (it has no page of its own).
    const league = screen.getByRole('button', { name: 'League' });
    expect(league.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(league.getAttribute('aria-controls') as string)?.hidden).toBe(true);
    fireEvent.click(league);
    expect(league.getAttribute('aria-expanded')).toBe('true');
    expect(within(nav()).getByRole('link', { name: 'Standings' })).toBeTruthy();
  });

  it('opens a group when the active page moves into it', () => {
    const { rerender } = render(<SideNav aria-label="League" items={items} />);
    expect(screen.getByRole('button', { name: 'League' }).getAttribute('aria-expanded')).toBe('false');
    const moved = items.map((item) =>
      item.id === 'league'
        ? { ...item, items: item.items?.map((c) => ({ ...c, active: c.id === 'standings' })) }
        : item.id === 'team'
          ? { ...item, items: item.items?.map((c) => ({ ...c, active: false })) }
          : item
    );
    rerender(<SideNav aria-label="League" items={moved} />);
    expect(screen.getByRole('button', { name: 'League' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('shows badges with their screen-reader label, and none for zero', () => {
    const { container } = render(<SideNav aria-label="League" items={items} />);
    const team = within(nav()).getByRole('link', { name: 'My Team 2 offers waiting' });
    expect(team.querySelector('.side-nav-badge-primary')).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: /^Trades/ }).querySelector('.side-nav-badge-error')?.textContent).toBe(
      '2'
    );
    const chat = within(nav()).getByRole('link', { name: 'Chat' });
    expect(chat.querySelector('.side-nav-badge')).toBeNull();
    expect(container.querySelectorAll('.side-nav-badge')).toHaveLength(2);
  });

  it("shows a closed group's child badge on the group, and only on the child once open", () => {
    const grouped: SideNavItem[] = [
      { id: 'home', label: 'Home', href: '/home', active: true },
      {
        id: 'team',
        label: 'My Team',
        items: [
          { id: 'lineup', label: 'Lineup', href: '/team/lineup' },
          { id: 'trades', label: 'Trades', href: '/team/trades', badge: 3, badgeLabel: '3 offers waiting' }
        ]
      }
    ];
    render(<SideNav aria-label="League" items={grouped} />);
    const team = screen.getByRole('button', { name: /^My Team/ });
    expect(team.textContent).toContain('3 offers waiting');
    fireEvent.click(team);
    expect(team.textContent).not.toContain('3 offers waiting');
    expect(within(nav()).getByRole('link', { name: /^Trades/ }).textContent).toContain('3 offers waiting');
  });

  it('routes links through linkComponent, keeping external ones as anchors', () => {
    const seen: string[] = [];
    const RouterLink = ({ href, children, ...rest }: AppNavLinkProps) => {
      seen.push(href);
      return (
        <a data-router="1" href={href} {...rest}>
          {children}
        </a>
      );
    };
    render(
      <SideNav
        aria-label="League"
        linkComponent={RouterLink}
        items={[
          { id: 'home', label: 'Home', href: '/home' },
          { id: 'docs', label: 'Docs', href: 'https://example.com', external: true }
        ]}
      />
    );
    expect(within(nav()).getByRole('link', { name: 'Home' }).getAttribute('data-router')).toBe('1');
    const docs = within(nav()).getByRole('link', { name: 'Docs' });
    expect(docs.getAttribute('data-router')).toBeNull();
    expect(docs.getAttribute('target')).toBe('_blank');
    expect(seen).toEqual(['/home']);
  });

  it('folds to an icon rail on desktop, linking groups to their first page', () => {
    const onCollapsedChange = vi.fn();
    const { container } = render(
      <SideNav aria-label="League" items={items} header={<p>Switcher</p>} onCollapsedChange={onCollapsedChange} />
    );
    const root = container.querySelector('.side-nav') as HTMLElement;
    expect(root.dataset.collapsed).toBeUndefined();
    expect(screen.getByText('Switcher')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(root.dataset.collapsed).toBe('true');
    expect(screen.queryByText('Switcher')).toBeNull();
    expect(container.querySelector('.side-nav-section-title')).toBeNull();
    // No groups in the rail: League (no page of its own) links to Scoreboard, with its name as a tooltip.
    const league = within(nav()).getByRole('link', { name: 'League' });
    expect(league.getAttribute('href')).toBe('/league/scoreboard');
    expect(league.getAttribute('title')).toBe('League');
    // My Team holds the active page, so its rail icon reads as active.
    expect(within(nav()).getByRole('link', { name: /^My Team/ }).classList.contains('side-nav-link-active')).toBe(true);
    expect(within(nav()).queryByRole('link', { name: 'Lineup' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(root.dataset.collapsed).toBeUndefined();
  });

  it('hides the collapse control when not collapsible, and honors a controlled rail', () => {
    const { rerender, container } = render(<SideNav aria-label="League" items={items} collapsible={false} />);
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
    rerender(<SideNav aria-label="League" items={items} collapsed />);
    expect((container.querySelector('.side-nav') as HTMLElement).dataset.collapsed).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    // Controlled: stays collapsed until the parent says otherwise.
    expect((container.querySelector('.side-nav') as HTMLElement).dataset.collapsed).toBe('true');
  });

  it('is a plain rail on desktop: no dialog, nothing inert', () => {
    const { container } = render(<SideNav aria-label="League" items={items} />);
    const panel = container.querySelector('.side-nav-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBeNull();
    expect(panel.hasAttribute('inert')).toBe(false);
  });

  describe('on a phone', () => {
    it('opens a modal drawer from the menu button, labeled with the current page', () => {
      const { container } = render(<SideNav aria-label="League" items={items} />);
      setPhone(true);
      const panel = container.querySelector('.side-nav-panel') as HTMLElement;
      expect(panel.hasAttribute('inert')).toBe(true);
      expect(panel.getAttribute('aria-hidden')).toBe('true');

      const trigger = screen.getByRole('button', { name: 'Open menu: Lineup' });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(panel.getAttribute('role')).toBe('dialog');
      expect(panel.getAttribute('aria-modal')).toBe('true');
      expect(panel.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(panel);
      expect(document.body.style.overflow).toBe('hidden');
      expect(container.querySelector('.side-nav-scrim')).toBeTruthy();
      // No rail on a phone.
      expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe('');
    });

    it('closes from the close button, the scrim, and after following a link', () => {
      const { container } = render(<SideNav aria-label="League" items={items} mobileTriggerLabel="Menu" />);
      setPhone(true);
      const trigger = screen.getByRole('button', { name: 'Open menu: Menu' });
      const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
      expect(isOpen()).toBe(false);

      fireEvent.click(trigger);
      fireEvent.click(container.querySelector('.side-nav-scrim') as HTMLElement);
      expect(isOpen()).toBe(false);

      fireEvent.click(trigger);
      fireEvent.click(within(nav()).getByRole('link', { name: 'Home' }));
      expect(isOpen()).toBe(false);
    });

    it('keeps Tab inside the open drawer', () => {
      render(<SideNav aria-label="League" items={[{ id: 'a', label: 'A', href: '/a' }, { id: 'b', label: 'B', href: '/b' }]} />);
      setPhone(true);
      fireEvent.click(screen.getByRole('button', { name: /^Open menu/ }));
      const last = within(nav()).getByRole('link', { name: 'B' });
      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
    });

    it('can be driven by the app, with its own trigger', () => {
      function Host() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              App menu
            </button>
            <SideNav aria-label="League" items={items} hideMobileTrigger mobileOpen={open} onMobileOpenChange={setOpen} />
          </>
        );
      }
      const { container } = render(<Host />);
      setPhone(true);
      expect(screen.queryByRole('button', { name: /^Open menu/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'App menu' }));
      expect((container.querySelector('.side-nav') as HTMLElement).dataset.state).toBe('open');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect((container.querySelector('.side-nav') as HTMLElement).dataset.state).toBe('closed');
    });
  });
});

describe('SideNavLayout', () => {
  it('puts the nav beside the page', () => {
    const { container } = render(
      <SideNavLayout nav={<SideNav aria-label="League" items={items} />}>
        <p>Page</p>
      </SideNavLayout>
    );
    const layout = container.firstElementChild as HTMLElement;
    expect(layout.classList.contains('side-nav-layout')).toBe(true);
    expect(layout.children[0]?.classList.contains('side-nav')).toBe(true);
    expect(layout.children[1]?.classList.contains('side-nav-layout-main')).toBe(true);
    expect(layout.children[1]?.textContent).toBe('Page');
  });
});
