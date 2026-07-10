/* Tests for the framework-agnostic AppNav (window.rscNav / nav.js). These
   assert the vanilla build emits the same DOM + class names the React AppNav
   does, so the shared styles.css applies unchanged, and that the launcher /
   profile / theme / mobile interactions behave like the component. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAppNav, type AppNavHandle } from './nav-browser';

let handle: AppNavHandle | null = null;
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  root.remove();
  document.documentElement.removeAttribute('data-theme');
  document.body.querySelectorAll('dialog').forEach((d) => d.remove());
});

const nav = () => root.querySelector('.app-nav') as HTMLElement;

describe('mountAppNav', () => {
  it('renders the brand mark and app name into the target', () => {
    handle = mountAppNav(root, { appName: 'JavaScript Concurrency' });
    expect(nav()).toBeTruthy();
    expect(root.querySelector('.app-nav-brand-mark')).toBeTruthy();
    expect(root.querySelector('.app-nav-brand-name')?.textContent).toBe('JavaScript Concurrency');
  });

  it('accepts a selector string as the target', () => {
    root.id = 'nav-host';
    handle = mountAppNav('#nav-host', { appName: 'RSC' });
    expect(root.querySelector('.app-nav-brand-name')?.textContent).toBe('RSC');
  });

  it('throws when the target is missing', () => {
    expect(() => mountAppNav('#does-not-exist', { appName: 'RSC' })).toThrow(/was not found/);
  });

  it('renders visible nav items and filters out visible:false', () => {
    handle = mountAppNav(root, {
      appName: 'RSC',
      navItems: [
        { id: 'lessons', label: 'Lessons', href: '/lessons/' },
        { id: 'podcast', label: 'Podcast', href: '/podcast/', visible: false },
        { id: 'about', label: 'About', href: '/about/', active: true }
      ]
    });
    const links = [...root.querySelectorAll('.app-nav-link')].map((l) => l.textContent);
    expect(links).toEqual(['Lessons', 'About']);
    expect(root.querySelector('.app-nav-link-active')?.textContent).toBe('About');
  });

  it('marks external links with target/rel', () => {
    handle = mountAppNav(root, {
      appName: 'RSC',
      navItems: [{ id: 'blog', label: 'Blog', href: 'https://x.test', external: true }]
    });
    const link = root.querySelector('.app-nav-link') as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('shows anonymous auth controls and no avatar/launcher', () => {
    handle = mountAppNav(root, { appName: 'RSC', authState: 'anonymous' });
    expect(root.querySelector('.app-nav-auth-actions')).toBeTruthy();
    expect(root.querySelector('.app-nav-auth-link')?.textContent).toBe('Sign in');
    expect(root.querySelector('.app-nav-auth-primary')?.textContent).toBe('Create account');
    expect(root.querySelector('.app-nav-avatar')).toBeNull();
    expect(document.body.querySelector('.app-launcher-modal')).toBeNull();
  });

  it('infers authenticated state from user and renders initials', () => {
    handle = mountAppNav(root, { appName: 'RSC', user: { name: 'Ada Lovelace' } });
    expect(root.querySelector('.app-nav-avatar')?.textContent).toBe('AL');
  });

  it('shows the app launcher only for authenticated users with visible services', () => {
    handle = mountAppNav(root, { appName: 'RSC', authState: 'authenticated', user: { email: 'a@b.co' } });
    const launcherBtn = root.querySelector('.app-nav-icon-btn[aria-label="Open app launcher"]') as HTMLButtonElement;
    expect(launcherBtn).toBeTruthy();
    // default registry has active external services
    launcherBtn.click();
    const dialog = document.body.querySelector('.app-launcher-modal') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll('.app-launcher-item').length).toBeGreaterThan(0);
  });

  it('hides the launcher when no services are visible', () => {
    handle = mountAppNav(root, {
      appName: 'RSC',
      authState: 'authenticated',
      user: { email: 'a@b.co' },
      services: []
    });
    expect(root.querySelector('.app-nav-icon-btn[aria-label="Open app launcher"]')).toBeNull();
  });

  it('opens the profile dialog and fires onSignOut', () => {
    const onSignOut = vi.fn();
    const onProfileClick = vi.fn();
    handle = mountAppNav(root, {
      appName: 'RSC',
      authState: 'authenticated',
      user: { name: 'Ada Lovelace', email: 'ada@rsc.io' },
      onSignOut,
      onProfileClick
    });
    (root.querySelector('.app-nav-avatar') as HTMLButtonElement).click();
    expect(onProfileClick).toHaveBeenCalledOnce();
    const dialog = document.body.querySelector('.profile-menu-modal') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.profile-menu-header h2')?.textContent).toBe('Ada Lovelace');
    (dialog.querySelector('.app-nav-sign-out-action') as HTMLButtonElement).click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('falls back to a sign-out link when onSignOut is not provided', () => {
    handle = mountAppNav(root, {
      appName: 'RSC',
      authState: 'authenticated',
      user: { name: 'Ada' },
      signOutAction: { label: 'Log out', href: '/logout' }
    });
    (root.querySelector('.app-nav-avatar') as HTMLButtonElement).click();
    const link = document.body.querySelector('.profile-menu-modal .app-nav-sign-out-action') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/logout');
    expect(link.textContent).toBe('Log out');
  });

  it('toggles the theme, writes data-theme, and reports it', () => {
    const onThemeChange = vi.fn();
    handle = mountAppNav(root, { appName: 'RSC', defaultTheme: 'light', onThemeChange });
    const themeBtn = () => root.querySelector('.app-nav-actions .app-nav-icon-btn') as HTMLButtonElement;
    expect(themeBtn().getAttribute('aria-label')).toBe('Switch to dark theme');
    themeBtn().click();
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(handle.getTheme()).toBe('dark');
    expect(themeBtn().getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('does not touch the document theme when applyThemeToDocument is false', () => {
    handle = mountAppNav(root, { appName: 'RSC', defaultTheme: 'light', applyThemeToDocument: false });
    (root.querySelector('.app-nav-actions .app-nav-icon-btn') as HTMLButtonElement).click();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('toggles the mobile menu collapse class', () => {
    handle = mountAppNav(root, { appName: 'RSC' });
    const menuBtn = () => root.querySelector('.app-nav-menu-btn') as HTMLButtonElement;
    expect(root.querySelector('.app-nav-collapse-open')).toBeNull();
    menuBtn().click();
    expect(root.querySelector('.app-nav-collapse-open')).toBeTruthy();
    expect(menuBtn().getAttribute('aria-expanded')).toBe('true');
  });

  it('update() merges options and re-renders in place', () => {
    handle = mountAppNav(root, { appName: 'RSC', authState: 'anonymous' });
    expect(root.querySelectorAll('.app-nav').length).toBe(1);
    handle.update({ appName: 'Renamed', authState: 'authenticated', user: { name: 'Ada' } });
    expect(root.querySelectorAll('.app-nav').length).toBe(1);
    expect(root.querySelector('.app-nav-brand-name')?.textContent).toBe('Renamed');
    expect(root.querySelector('.app-nav-avatar')?.textContent).toBe('A');
  });

  it('destroy() removes the header and its dialogs', () => {
    handle = mountAppNav(root, { appName: 'RSC', authState: 'authenticated', user: { email: 'a@b.co' } });
    (root.querySelector('.app-nav-avatar') as HTMLButtonElement).click();
    expect(document.body.querySelector('.profile-menu-modal')).toBeTruthy();
    handle.destroy();
    handle = null;
    expect(root.querySelector('.app-nav')).toBeNull();
    expect(document.body.querySelector('.profile-menu-modal')).toBeNull();
    expect(document.body.querySelector('.app-launcher-modal')).toBeNull();
  });
});
