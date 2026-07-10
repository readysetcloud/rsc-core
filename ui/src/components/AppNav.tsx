import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getVisibleServices, readySetCloudServices, type RscService } from '../services/registry';
import { Badge } from './Badge';
import { Button } from './Button';
import { Modal } from './Modal';
import { cx } from './cx';

export type AppTheme = 'light' | 'dark' | 'system';
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

export interface AppNavProps {
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
      <header className={cx('app-nav', className)}>
        <div className="app-nav-inner">
          <a className="app-nav-brand" href={homeHref}>
            <span className="app-nav-brand-mark" aria-hidden="true" />
            <span className="app-nav-brand-name">{appName}</span>
          </a>

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
                {visibleNavItems.map((item) => (
                  <a
                    key={item.id}
                    className={cx(
                      'app-nav-link',
                      item.active && 'app-nav-link-active',
                      item.highlight && 'app-nav-link-highlight'
                    )}
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noreferrer' : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            )}

            <div className="app-nav-actions">
              {actions}
              {primaryAction && (
                primaryAction.href ? (
                  <a
                    className="btn btn-primary app-nav-primary-action"
                    href={primaryAction.href}
                    target={primaryAction.external ? '_blank' : undefined}
                    rel={primaryAction.external ? 'noreferrer' : undefined}
                  >
                    {primaryAction.label}
                  </a>
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
                  <AppNavActionControl action={resolvedSignInAction} className="app-nav-auth-link" />
                  <AppNavActionControl action={resolvedSignUpAction} className="btn btn-primary app-nav-auth-primary" />
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
              <AppNavActionControl action={resolvedSignOutAction} className="btn btn-secondary app-nav-sign-out-action" />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function AppNavActionControl({ action, className }: { action: AppNavAction; className?: string }) {
  if (action.href) {
    return (
      <a
        className={className}
        href={action.href}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noreferrer' : undefined}
      >
        {action.label}
      </a>
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
