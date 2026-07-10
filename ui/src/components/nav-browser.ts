/*
 * Framework-agnostic AppNav for plain <script> consumers (the static
 * course pages, Hugo, anything that can't import the React component).
 * No React, no deps — it builds the exact DOM the React `AppNav` renders
 * so the shared `@readysetcloud/ui/styles.css` (the `.app-nav`,
 * `.app-launcher`, `.profile-menu` rules) styles it identically.
 *
 * IIFE build exposes everything as `window.rscNav`:
 *
 *   <link rel="stylesheet" href="https://<assets>/ui/<version>/styles/index.css">
 *   <div id="nav"></div>
 *   <script src="https://<assets>/ui/<version>/nav.global.js"></script>
 *   <script>
 *     const nav = rscNav.mountAppNav('#nav', {
 *       appName: 'JavaScript Concurrency',
 *       currentServiceId: 'bootcamp',
 *       authState: 'authenticated',
 *       user: { name: 'Ada Lovelace', email: 'ada@example.com' },
 *       navItems: [{ id: 'lessons', label: 'Lessons', href: '/lessons/' }],
 *       onSignOut: () => rscAuth.signOut()
 *     });
 *     // later: nav.update({ user: nextUser }); nav.destroy();
 *   </script>
 *
 * The ESM build (nav.js) serves `import { mountAppNav } from '.../nav.js'`.
 */

import { getVisibleServices, readySetCloudServices, type RscService } from '../services/registry';

export type AppNavTheme = 'light' | 'dark' | 'system';
export type AppNavAuthState = 'none' | 'anonymous' | 'authenticated';

export interface AppNavUser {
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface AppNavItem {
  id: string;
  label: string;
  href: string;
  active?: boolean;
  external?: boolean;
  highlight?: boolean;
  visible?: boolean;
}

export interface AppNavAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
}

export interface AppNavOptions {
  appName: string;
  navItems?: readonly AppNavItem[];
  primaryAction?: AppNavAction;
  services?: readonly RscService[];
  currentServiceId?: string;
  homeHref?: string;
  user?: AppNavUser;
  authState?: AppNavAuthState;
  signInAction?: AppNavAction;
  signUpAction?: AppNavAction;
  signOutAction?: AppNavAction;
  theme?: AppNavTheme;
  defaultTheme?: AppNavTheme;
  applyThemeToDocument?: boolean;
  onThemeChange?: (theme: AppNavTheme) => void;
  onProfileClick?: () => void;
  onSignOut?: () => void;
  className?: string;
}

export interface AppNavHandle {
  /** Merge new options and re-render (e.g. after auth resolves). */
  update(options: Partial<AppNavOptions>): void;
  /** The theme currently applied by the nav. */
  getTheme(): AppNavTheme;
  /** Programmatically set the theme (mirrors the toggle button). */
  setTheme(theme: AppNavTheme): void;
  /** Remove the nav and its dialogs and detach all listeners. */
  destroy(): void;
}

type El = HTMLElement;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Mount the shared AppNav into `target` (a selector or element) and return a
 * handle for updating/destroying it. The nav owns its own launcher/profile
 * dialogs, theme toggle, and mobile menu — the same behavior as the React
 * component.
 */
export function mountAppNav(target: string | El, options: AppNavOptions): AppNavHandle {
  const root = typeof target === 'string' ? document.querySelector<El>(target) : target;
  if (!root) {
    throw new Error(`mountAppNav: target ${JSON.stringify(target)} was not found`);
  }

  let opts: AppNavOptions = { ...options };

  // Controlled theme wins; otherwise the nav tracks its own (uncontrolled) theme.
  let uncontrolledTheme: AppNavTheme = opts.defaultTheme ?? 'system';
  let launcherOpen = false;
  let profileOpen = false;
  let mobileNavOpen = false;

  const currentTheme = (): AppNavTheme => opts.theme ?? uncontrolledTheme;

  const applyTheme = () => {
    if (opts.applyThemeToDocument === false || typeof document === 'undefined') return;
    const theme = currentTheme();
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = theme;
    }
  };

  const toggleTheme = () => {
    const next: AppNavTheme = currentTheme() === 'dark' ? 'light' : 'dark';
    if (opts.theme === undefined) uncontrolledTheme = next;
    opts.onThemeChange?.(next);
    applyTheme();
    render();
  };

  // Dialogs live on <body> so the top-layer promotion isn't clipped by a
  // container with `overflow: hidden`.
  let launcherDialog: HTMLDialogElement | null = null;
  let profileDialog: HTMLDialogElement | null = null;

  const openDialog = (dialog: HTMLDialogElement | null) => {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const closeDialog = (dialog: HTMLDialogElement | null) => {
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const syncDialogs = () => {
    if (launcherOpen) openDialog(launcherDialog);
    else closeDialog(launcherDialog);
    if (profileOpen) openDialog(profileDialog);
    else closeDialog(profileDialog);
  };

  function render() {
    const {
      appName,
      navItems = [],
      primaryAction,
      services = readySetCloudServices,
      currentServiceId,
      homeHref = '/',
      user,
      authState,
      className
    } = opts;

    const theme = currentTheme();
    const visibleServices = getVisibleServices(services);
    const visibleNavItems = navItems.filter((item) => item.visible !== false);
    const resolvedAuthState: AppNavAuthState = authState ?? (user ? 'authenticated' : 'none');
    const showAuthenticated = resolvedAuthState === 'authenticated';
    const showAnonymous = resolvedAuthState === 'anonymous';
    const showAppLauncher = showAuthenticated && visibleServices.length > 0;
    const signInAction = opts.signInAction ?? { label: 'Sign in', href: '/login' };
    const signUpAction = opts.signUpAction ?? { label: 'Create account', href: '/signup' };
    const signOutAction = opts.signOutAction ?? { label: 'Sign out', href: '/logout' };
    const initials = getInitials(user?.name ?? user?.email ?? appName);

    // ---- header ----
    const header = h('header', { class: cx('app-nav', className) });
    const inner = h('div', { class: 'app-nav-inner' });
    header.appendChild(inner);

    const brand = h('a', { class: 'app-nav-brand', href: homeHref });
    brand.appendChild(h('span', { class: 'app-nav-brand-mark', 'aria-hidden': 'true' }));
    brand.appendChild(h('span', { class: 'app-nav-brand-name' }, appName));
    inner.appendChild(brand);

    const menuBtn = h('button', {
      type: 'button',
      class: 'app-nav-menu-btn',
      'aria-label': 'Toggle navigation',
      'aria-expanded': String(mobileNavOpen)
    });
    menuBtn.appendChild(icon(ICON_PATHS.menu));
    menuBtn.addEventListener('click', () => {
      mobileNavOpen = !mobileNavOpen;
      render();
    });
    inner.appendChild(menuBtn);

    const collapse = h('div', {
      class: cx('app-nav-collapse', mobileNavOpen && 'app-nav-collapse-open')
    });
    inner.appendChild(collapse);

    if (visibleNavItems.length > 0) {
      const nav = h('nav', { class: 'app-nav-links', 'aria-label': 'Primary navigation' });
      for (const item of visibleNavItems) {
        nav.appendChild(
          h(
            'a',
            {
              class: cx(
                'app-nav-link',
                item.active && 'app-nav-link-active',
                item.highlight && 'app-nav-link-highlight'
              ),
              href: item.href,
              ...externalAttrs(item.external)
            },
            item.label
          )
        );
      }
      collapse.appendChild(nav);
    }

    const actions = h('div', { class: 'app-nav-actions' });
    collapse.appendChild(actions);

    if (primaryAction) {
      if (primaryAction.href) {
        actions.appendChild(
          h(
            'a',
            {
              class: 'btn btn-primary app-nav-primary-action',
              href: primaryAction.href,
              ...externalAttrs(primaryAction.external)
            },
            primaryAction.label
          )
        );
      } else {
        const btn = h('button', { type: 'button', class: 'btn btn-primary app-nav-primary-action' }, primaryAction.label);
        if (primaryAction.onClick) btn.addEventListener('click', primaryAction.onClick);
        actions.appendChild(btn);
      }
    }

    if (showAppLauncher) {
      const launcherBtn = h('button', {
        type: 'button',
        class: 'app-nav-icon-btn',
        'aria-label': 'Open app launcher'
      });
      launcherBtn.appendChild(icon(ICON_PATHS.grid));
      launcherBtn.addEventListener('click', () => {
        launcherOpen = true;
        syncDialogs();
      });
      actions.appendChild(launcherBtn);
    }

    const themeBtn = h('button', {
      type: 'button',
      class: 'app-nav-icon-btn',
      'aria-label': `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
    });
    themeBtn.appendChild(icon(theme === 'dark' ? ICON_PATHS.sun : ICON_PATHS.moon));
    themeBtn.addEventListener('click', toggleTheme);
    actions.appendChild(themeBtn);

    if (showAnonymous) {
      const authActions = h('div', { class: 'app-nav-auth-actions' });
      authActions.appendChild(actionControl(signInAction, 'app-nav-auth-link'));
      authActions.appendChild(actionControl(signUpAction, 'btn btn-primary app-nav-auth-primary'));
      actions.appendChild(authActions);
    }

    if (showAuthenticated) {
      const avatar = h('button', { type: 'button', class: 'app-nav-avatar', 'aria-label': 'Open profile menu' });
      avatar.appendChild(avatarContent(user, initials));
      avatar.addEventListener('click', () => {
        opts.onProfileClick?.();
        profileOpen = true;
        syncDialogs();
      });
      actions.appendChild(avatar);
    }

    // ---- launcher dialog ----
    const nextLauncher = showAppLauncher
      ? buildLauncherDialog(visibleServices, currentServiceId, () => {
          launcherOpen = false;
          syncDialogs();
        })
      : null;

    // ---- profile dialog ----
    const nextProfile = showAuthenticated
      ? buildProfileDialog(user, initials, signOutAction, opts.onSignOut, () => {
          profileOpen = false;
          syncDialogs();
        })
      : null;

    // ---- swap into the DOM ----
    if (headerEl) headerEl.replaceWith(header);
    else root!.appendChild(header);
    headerEl = header;

    // Detaching a dialog from the DOM drops it from the top layer without
    // firing `close`, so a re-render never spuriously flips our open state —
    // syncDialogs() below re-opens the fresh dialog if the flag says so.
    if (launcherDialog && launcherDialog !== nextLauncher) launcherDialog.remove();
    launcherDialog = nextLauncher;
    if (profileDialog && profileDialog !== nextProfile) profileDialog.remove();
    profileDialog = nextProfile;

    // If the controls that own a dialog are gone, its open flag can't stand.
    if (!launcherDialog) launcherOpen = false;
    if (!profileDialog) profileOpen = false;

    syncDialogs();
  }

  let headerEl: El | null = null;

  applyTheme();
  render();

  return {
    update(next) {
      opts = { ...opts, ...next };
      applyTheme();
      render();
    },
    getTheme: currentTheme,
    setTheme(theme) {
      if (opts.theme === undefined) uncontrolledTheme = theme;
      else opts.theme = theme;
      applyTheme();
      render();
    },
    destroy() {
      closeDialog(launcherDialog);
      closeDialog(profileDialog);
      launcherDialog?.remove();
      profileDialog?.remove();
      headerEl?.remove();
      headerEl = null;
      launcherDialog = null;
      profileDialog = null;
    }
  };

  // ---- dialog builders ----

  function buildLauncherDialog(
    services: readonly RscService[],
    currentServiceId: string | undefined,
    onClose: () => void
  ): HTMLDialogElement {
    const dialog = createDialog('app-launcher-modal', 'App launcher', onClose);

    const wrap = h('div', { class: 'app-launcher' });
    const header = h('div', { class: 'app-launcher-header' });
    const copy = h('div');
    copy.appendChild(h('h2', {}, 'Apps'));
    copy.appendChild(h('p', {}, 'Jump to another ReadySetCloud service.'));
    header.appendChild(copy);
    const closeBtn = h('button', { type: 'button', class: 'app-nav-icon-btn', 'aria-label': 'Close app launcher' });
    closeBtn.appendChild(icon(ICON_PATHS.close));
    closeBtn.addEventListener('click', onClose);
    header.appendChild(closeBtn);
    wrap.appendChild(header);

    const grid = h('div', { class: 'app-launcher-grid' });
    for (const service of services) {
      const item = h('a', {
        class: cx('app-launcher-item', service.id === currentServiceId && 'app-launcher-item-active'),
        href: service.href,
        ...externalAttrs(service.external)
      });

      const iconWrap = h('span', { class: 'app-launcher-icon' });
      if (service.iconUrl) {
        iconWrap.appendChild(h('img', { src: service.iconUrl, alt: '' }));
      } else {
        iconWrap.textContent = getInitials(service.shortName ?? service.name);
      }
      item.appendChild(iconWrap);

      const itemCopy = h('span', { class: 'app-launcher-copy' });
      itemCopy.appendChild(h('span', { class: 'app-launcher-name' }, service.name));
      if (service.description) {
        itemCopy.appendChild(h('span', { class: 'app-launcher-description' }, service.description));
      }
      if (service.category) {
        itemCopy.appendChild(h('span', { class: 'badge badge-neutral' }, service.category));
      }
      item.appendChild(itemCopy);

      grid.appendChild(item);
    }
    wrap.appendChild(grid);
    dialog.appendChild(wrap);
    return dialog;
  }

  function buildProfileDialog(
    user: AppNavUser | undefined,
    initials: string,
    signOutAction: AppNavAction,
    onSignOut: (() => void) | undefined,
    onClose: () => void
  ): HTMLDialogElement {
    const dialog = createDialog('profile-menu-modal', 'Profile menu', onClose);

    const wrap = h('div', { class: 'profile-menu' });
    const header = h('div', { class: 'profile-menu-header' });
    const avatar = h('span', { class: 'app-nav-avatar profile-menu-avatar' });
    avatar.appendChild(avatarContent(user, initials));
    header.appendChild(avatar);
    const copy = h('div');
    copy.appendChild(h('h2', {}, user?.name ?? 'Account'));
    if (user?.email) copy.appendChild(h('p', {}, user.email));
    header.appendChild(copy);
    wrap.appendChild(header);

    if (onSignOut) {
      const btn = h('button', { type: 'button', class: 'btn btn-secondary app-nav-sign-out-action' }, 'Sign out');
      btn.addEventListener('click', onSignOut);
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(actionControl(signOutAction, 'btn btn-secondary app-nav-sign-out-action'));
    }

    dialog.appendChild(wrap);
    return dialog;
  }
}

/* ---------- shared helpers ---------- */

function createDialog(className: string, label: string, onClose: () => void): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = cx('modal', className);
  dialog.setAttribute('aria-label', label);
  // Backdrop click (target is the dialog itself) closes, matching the React Modal.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) onClose();
  });
  // Esc / programmatic close keeps our state in sync.
  dialog.addEventListener('close', onClose);
  document.body.appendChild(dialog);
  return dialog;
}

function actionControl(action: AppNavAction, className: string): El {
  if (action.href) {
    return h('a', { class: className, href: action.href, ...externalAttrs(action.external) }, action.label);
  }
  const btn = h('button', { type: 'button', class: className }, action.label);
  if (action.onClick) btn.addEventListener('click', action.onClick);
  return btn;
}

function avatarContent(user: AppNavUser | undefined, initials: string): El | Text {
  if (user?.avatarUrl) return h('img', { src: user.avatarUrl, alt: '' });
  return document.createTextNode(initials);
}

function externalAttrs(external?: boolean): Record<string, string> {
  return external ? { target: '_blank', rel: 'noreferrer' } : {};
}

function getInitials(value: string): string {
  const clean = value.trim();
  if (!clean) return 'RSC';
  const parts = clean.split(/[\s@.-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || 'RSC';
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function h(tag: string, props: Record<string, unknown> = {}, ...children: Array<El | Text | string>): El {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const ICON_PATHS = {
  grid: 'M4 4h4v4H4V4Zm6 0h4v4h-4V4Zm6 0h4v4h-4V4ZM4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM4 16h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z',
  menu: 'M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z',
  moon: 'M20.2 14.1A7.7 7.7 0 0 1 9.9 3.8 8.5 8.5 0 1 0 20.2 14.1Z',
  sun: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-5 1.4 3h-2.8L12 2Zm0 20-1.4-3h2.8L12 22ZM2 12l3-1.4v2.8L2 12Zm20 0-3 1.4v-2.8L22 12ZM4.9 4.9l3.1 1.1-2 2-1.1-3.1Zm14.2 14.2L16 18l2-2 1.1 3.1Zm0-14.2L18 8l-2-2 3.1-1.1ZM4.9 19.1 6 16l2 2-3.1 1.1Z',
  close: 'm6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z'
};

function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export { getVisibleServices, readySetCloudServices, type RscService } from '../services/registry';
