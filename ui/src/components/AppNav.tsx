import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { getVisibleServices, readySetCloudServices, type RscService } from '../services/registry';
import { Badge } from './Badge';
import { Button } from './Button';
import { Modal } from './Modal';
import { cx } from './cx';

export type AppTheme = 'light' | 'dark' | 'system';
export type AppNavAuthState = 'none' | 'anonymous' | 'authenticated';
export type AppNavLayout = 'top' | 'side';

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
  /** Optional leading icon (e.g. an SVG element). Rendered before the label. */
  icon?: ReactNode;
  /**
   * Optional section heading. Consecutive items sharing a section are grouped
   * under one heading in the `side` layout (ignored in the `top` layout).
   */
  section?: string;
}

export interface AppNavAction {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
}

/**
 * Props passed to a custom `linkComponent`. Mirrors the anchor attributes
 * `AppNav` would otherwise set, with `href` as the target — map it to your
 * router's own prop (e.g. React Router: `({ href, ...rest }) => <Link to={href} {...rest} />`).
 */
export interface AppNavLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  'aria-current'?: 'page';
}

export type AppNavLinkComponent = ComponentType<AppNavLinkProps>;

export interface AppNavProps {
  appName: string;
  navItems?: readonly AppNavItem[];
  primaryAction?: AppNavAction;
  services?: readonly RscService[];
  currentServiceId?: string;
  homeHref?: string;
  /** `top` (default) renders the horizontal bar; `side` renders a vertical rail. */
  layout?: AppNavLayout;
  /**
   * Render in-app links with your router's link component to keep navigation
   * client-side (no full-page reload). Applied to the brand, nav items, primary
   * action, and auth actions — external links always use a plain anchor.
   */
  linkComponent?: AppNavLinkComponent;
  user?: AppNavUser;
  authState?: AppNavAuthState;
  signInAction?: AppNavAction;
  signUpAction?: AppNavAction;
  signOutAction?: AppNavAction;
  theme?: AppTheme;
  defaultTheme?: AppTheme;
  applyThemeToDocument?: boolean;
  actions?: ReactNode;
  onThemeChange?: (theme: AppTheme) => void;
  onProfileClick?: () => void;
  onSignOut?: () => void;
  className?: string;
}

export function AppNav({
  appName,
  navItems = [],
  primaryAction,
  services = readySetCloudServices,
  currentServiceId,
  homeHref = '/',
  layout = 'top',
  linkComponent,
  user,
  authState,
  signInAction,
  signUpAction,
  signOutAction,
  theme,
  defaultTheme = 'system',
  applyThemeToDocument = true,
  actions,
  onThemeChange,
  onProfileClick,
  onSignOut,
  className
}: AppNavProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [uncontrolledTheme, setUncontrolledTheme] = useState<AppTheme>(defaultTheme);
  const selectedTheme = theme ?? uncontrolledTheme;
  const visibleServices = useMemo(() => getVisibleServices(services), [services]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => item.visible !== false), [navItems]);
  const navGroups = useMemo(() => groupNavItems(visibleNavItems), [visibleNavItems]);
  const isSide = layout === 'side';
  const resolvedAuthState = authState ?? (user ? 'authenticated' : 'none');
  const showAuthenticatedControls = resolvedAuthState === 'authenticated';
  const showAnonymousControls = resolvedAuthState === 'anonymous';
  const showAppLauncher = showAuthenticatedControls && visibleServices.length > 0;
  const resolvedSignInAction = signInAction ?? { label: 'Sign in', href: '/login' };
  const resolvedSignUpAction = signUpAction ?? { label: 'Create account', href: '/signup' };
  const resolvedSignOutAction = signOutAction ?? { label: 'Sign out', href: '/logout' };

  useEffect(() => {
    if (!applyThemeToDocument || typeof document === 'undefined') return;
    if (selectedTheme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    document.documentElement.dataset.theme = selectedTheme;
  }, [applyThemeToDocument, selectedTheme]);

  const toggleTheme = () => {
    const next = selectedTheme === 'dark' ? 'light' : 'dark';
    if (theme === undefined) setUncontrolledTheme(next);
    onThemeChange?.(next);
  };

  const initials = getInitials(user?.name ?? user?.email ?? appName);

  return (
    <>
      <header className={cx('app-nav', isSide && 'app-nav-side', className)}>
        <div className="app-nav-inner">
          <AppNavAnchor className="app-nav-brand" href={homeHref} linkComponent={linkComponent}>
            <span className="app-nav-brand-mark" aria-hidden="true" />
            <span className="app-nav-brand-name">{appName}</span>
          </AppNavAnchor>

          <button
            type="button"
            className="app-nav-menu-btn"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
          >
            <MenuIcon />
          </button>

          <div className={cx('app-nav-collapse', mobileNavOpen && 'app-nav-collapse-open')}>
            {visibleNavItems.length > 0 && (
              <nav className="app-nav-links" aria-label="Primary navigation">
                {isSide
                  ? navGroups.map((group, index) => (
                      <div className="app-nav-section" key={group.section ?? `__ungrouped-${index}`}>
                        {group.section && <span className="app-nav-section-title">{group.section}</span>}
                        {group.items.map((item) => (
                          <AppNavLink key={item.id} item={item} linkComponent={linkComponent} />
                        ))}
                      </div>
                    ))
                  : visibleNavItems.map((item) => (
                      <AppNavLink key={item.id} item={item} linkComponent={linkComponent} />
                    ))}
              </nav>
            )}

            <div className="app-nav-actions">
              {actions}
              {primaryAction && (
                primaryAction.href ? (
                  <AppNavAnchor
                    className="btn btn-primary app-nav-primary-action"
                    href={primaryAction.href}
                    external={primaryAction.external}
                    linkComponent={linkComponent}
                  >
                    {primaryAction.label}
                  </AppNavAnchor>
                ) : (
                  <Button className="app-nav-primary-action" onClick={primaryAction.onClick}>
                    {primaryAction.label}
                  </Button>
                )
              )}
              {showAppLauncher && (
                <button
                  type="button"
                  className="app-nav-icon-btn"
                  onClick={() => setLauncherOpen(true)}
                  aria-label="Open app launcher"
                >
                  <GridIcon />
                </button>
              )}
              <button
                type="button"
                className="app-nav-icon-btn"
                onClick={toggleTheme}
                aria-label={`Switch to ${selectedTheme === 'dark' ? 'light' : 'dark'} theme`}
              >
                {selectedTheme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
              {showAnonymousControls && (
                <div className="app-nav-auth-actions">
                  <AppNavActionControl action={resolvedSignInAction} className="app-nav-auth-link" linkComponent={linkComponent} />
                  <AppNavActionControl action={resolvedSignUpAction} className="btn btn-primary app-nav-auth-primary" linkComponent={linkComponent} />
                </div>
              )}
              {showAuthenticatedControls && (
                <button
                  type="button"
                  className="app-nav-avatar"
                  onClick={() => {
                    onProfileClick?.();
                    setProfileOpen(true);
                  }}
                  aria-label="Open profile menu"
                >
                  {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {showAppLauncher && (
        <Modal open={launcherOpen} onClose={() => setLauncherOpen(false)} className="app-launcher-modal" aria-label="App launcher">
          <div className="app-launcher">
            <div className="app-launcher-header">
              <div>
                <h2>Apps</h2>
                <p>Jump to another ReadySetCloud service.</p>
              </div>
              <button type="button" className="app-nav-icon-btn" onClick={() => setLauncherOpen(false)} aria-label="Close app launcher">
                <CloseIcon />
              </button>
            </div>
            <div className="app-launcher-grid">
              {visibleServices.map((service) => (
                <a
                  key={service.id}
                  className={cx('app-launcher-item', service.id === currentServiceId && 'app-launcher-item-active')}
                  href={service.href}
                  target={service.external ? '_blank' : undefined}
                  rel={service.external ? 'noreferrer' : undefined}
                >
                  <span className="app-launcher-icon">
                    {service.iconUrl ? <img src={service.iconUrl} alt="" /> : getInitials(service.shortName ?? service.name)}
                  </span>
                  <span className="app-launcher-copy">
                    <span className="app-launcher-name">{service.name}</span>
                    {service.description && <span className="app-launcher-description">{service.description}</span>}
                    {service.category && <Badge variant="neutral">{service.category}</Badge>}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {showAuthenticatedControls && (
        <Modal open={profileOpen} onClose={() => setProfileOpen(false)} className="profile-menu-modal" aria-label="Profile menu">
          <div className="profile-menu">
            <div className="profile-menu-header">
              <span className="app-nav-avatar profile-menu-avatar">
                {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
              </span>
              <div>
                <h2>{user?.name ?? 'Account'}</h2>
                {user?.email && <p>{user.email}</p>}
              </div>
            </div>
            {onSignOut ? (
              <Button variant="secondary" block onClick={onSignOut}>
                Sign out
              </Button>
            ) : (
              <AppNavActionControl action={resolvedSignOutAction} className="btn btn-secondary app-nav-sign-out-action" linkComponent={linkComponent} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

interface AppNavGroup {
  section?: string;
  items: AppNavItem[];
}

/**
 * Collapse a flat item list into consecutive runs sharing a `section`. This
 * preserves the caller's order, so ungrouped items stay where they are (e.g. a
 * standalone "Dashboard" at the top and "Brand" at the bottom of a side rail).
 */
function groupNavItems(items: readonly AppNavItem[]): AppNavGroup[] {
  const groups: AppNavGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

/**
 * Renders an in-app link through `linkComponent` when one is supplied, falling
 * back to a plain anchor. External links always use the anchor (a router link
 * can't own a cross-origin navigation) and keep `target`/`rel`.
 */
function AppNavAnchor({
  href,
  className,
  external,
  ariaCurrent,
  linkComponent: LinkComponent,
  children
}: {
  href: string;
  className?: string;
  external?: boolean;
  ariaCurrent?: 'page';
  linkComponent?: AppNavLinkComponent;
  children: ReactNode;
}) {
  if (LinkComponent && !external) {
    return (
      <LinkComponent href={href} className={className} aria-current={ariaCurrent}>
        {children}
      </LinkComponent>
    );
  }
  return (
    <a
      className={className}
      href={href}
      aria-current={ariaCurrent}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
    >
      {children}
    </a>
  );
}

function AppNavLink({ item, linkComponent }: { item: AppNavItem; linkComponent?: AppNavLinkComponent }) {
  return (
    <AppNavAnchor
      className={cx(
        'app-nav-link',
        item.active && 'app-nav-link-active',
        item.highlight && 'app-nav-link-highlight'
      )}
      href={item.href}
      external={item.external}
      ariaCurrent={item.active ? 'page' : undefined}
      linkComponent={linkComponent}
    >
      {item.icon && (
        <span className="app-nav-link-icon" aria-hidden="true">
          {item.icon}
        </span>
      )}
      {item.label}
    </AppNavAnchor>
  );
}

function AppNavActionControl({
  action,
  className,
  linkComponent
}: {
  action: AppNavAction;
  className?: string;
  linkComponent?: AppNavLinkComponent;
}) {
  if (action.href) {
    return (
      <AppNavAnchor className={className} href={action.href} external={action.external} linkComponent={linkComponent}>
        {action.label}
      </AppNavAnchor>
    );
  }

  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

function getInitials(value: string) {
  const clean = value.trim();
  if (!clean) return 'RSC';
  const parts = clean.split(/[\s@.-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || 'RSC';
}

function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 4h4v4H4V4Zm6 0h4v4h-4V4Zm6 0h4v4h-4V4ZM4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM4 16h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M20.2 14.1A7.7 7.7 0 0 1 9.9 3.8 8.5 8.5 0 1 0 20.2 14.1Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0-5 1.4 3h-2.8L12 2Zm0 20-1.4-3h2.8L12 22ZM2 12l3-1.4v2.8L2 12Zm20 0-3 1.4v-2.8L22 12ZM4.9 4.9l3.1 1.1-2 2-1.1-3.1Zm14.2 14.2L16 18l2-2 1.1 3.1Zm0-14.2L18 8l-2-2 3.1-1.1ZM4.9 19.1 6 16l2 2-3.1 1.1Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" />
    </svg>
  );
}
