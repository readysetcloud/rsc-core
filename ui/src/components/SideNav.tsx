import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import type { AppNavLinkComponent } from './AppNav';
import { cx } from './cx';
import { lockBodyScroll, setDrawerPanelInert, trapDrawerTab } from './drawer-core';

/** Below this width the rail becomes a drawer opened from a menu button. */
export const SIDE_NAV_PHONE_QUERY = '(max-width: 768px)';

export type SideNavBadgeTone = 'primary' | 'neutral' | 'success' | 'warning' | 'error';

export interface SideNavItem {
  id: string;
  label: string;
  /**
   * Where the item goes. A group (an item with `items`) can leave it out: its
   * row then only opens and closes the group, and the collapsed rail links it
   * to its first child.
   */
  href?: string;
  /** Leading icon (e.g. an SVG). The collapsed rail shows only this. */
  icon?: ReactNode;
  /**
   * A count or short tag after the label. `0`, `''` and `undefined` show nothing. A closed group,
   * or a group in the collapsed rail, shows its first child's badge when it has none of its own.
   */
  badge?: number | string;
  /** Screen-reader text for the badge, e.g. "2 offers waiting" (default: the badge itself). */
  badgeLabel?: string;
  badgeTone?: SideNavBadgeTone;
  active?: boolean;
  external?: boolean;
  visible?: boolean;
  /**
   * Heading for a run of top-level items: consecutive items with the same
   * section are grouped under it, as in `AppNav`'s side layout.
   */
  section?: string;
  /** Nested items: renders a group that opens and closes. */
  items?: readonly SideNavItem[];
  /** Whether a group starts open (default: open when it holds the active item). */
  defaultExpanded?: boolean;
}

export interface SideNavProps {
  items: readonly SideNavItem[];
  /** Accessible name for the navigation (default `Section navigation`). */
  'aria-label'?: string;
  /** Above the items, e.g. a switcher. Hidden while the desktop rail is collapsed. */
  header?: ReactNode;
  /** Below the items. Hidden while the desktop rail is collapsed. */
  footer?: ReactNode;
  /** Your router's link, as for `AppNav` (`({ href, ...rest }) => <Link to={href} {...rest} />`). */
  linkComponent?: AppNavLinkComponent;
  /** Show the desktop button that folds the nav to an icon rail (default true). */
  collapsible?: boolean;
  /** Controlled rail state. Omit to let the nav own it. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Controlled phone drawer state. Omit to let the nav own it. */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  /** Text on the phone menu button (default: the active item's label, else the nav's name). */
  mobileTriggerLabel?: ReactNode;
  /** Hide the phone menu button when the app opens the drawer from its own control. */
  hideMobileTrigger?: boolean;
  className?: string;
}

function isShown(item: SideNavItem): boolean {
  return item.visible !== false;
}

function holdsActive(item: SideNavItem): boolean {
  return item.active === true || (item.items ?? []).some((child) => isShown(child) && holdsActive(child));
}

/** The deepest active item, for the phone button's label. */
function activeItem(items: readonly SideNavItem[]): SideNavItem | undefined {
  for (const item of items) {
    if (!isShown(item)) continue;
    const child = activeItem(item.items ?? []);
    if (child) return child;
    if (item.active) return item;
  }
  return undefined;
}

/** Where a group goes in the rail, where it can't open: its own href, else its first child's. */
function railHref(item: SideNavItem): string | undefined {
  return item.href ?? (item.items ?? []).filter(isShown).map(railHref).find((href) => href !== undefined);
}

interface SideNavGroup {
  section?: string;
  items: SideNavItem[];
}

function groupBySection(items: readonly SideNavItem[]): SideNavGroup[] {
  const groups: SideNavGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(SIDE_NAV_PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return phone;
}

/**
 * In-app section navigation that sits beside the page: icons, badges, nested
 * groups, and an active item. On desktop it is a sticky rail that folds to
 * icons (`collapsible`); on a phone it becomes a modal drawer opened from a
 * menu button it renders in the page flow. Pair it with `SideNavLayout`, under
 * an `AppNav` top bar.
 */
export function SideNav({
  items,
  'aria-label': ariaLabel = 'Section navigation',
  header,
  footer,
  linkComponent,
  collapsible = true,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  mobileOpen,
  onMobileOpenChange,
  mobileTriggerLabel,
  hideMobileTrigger = false,
  className
}: SideNavProps) {
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsed ?? uncontrolledCollapsed;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = mobileOpen ?? uncontrolledOpen;
  const phone = usePhone();
  const drawerOpen = phone && isOpen;

  const panelId = `${useId()}-side-nav`;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(drawerOpen);

  const setOpen = useCallback(
    (next: boolean) => {
      if (mobileOpen === undefined) setUncontrolledOpen(next);
      onMobileOpenChange?.(next);
    },
    [mobileOpen, onMobileOpenChange]
  );

  const setCollapsed = (next: boolean) => {
    if (collapsed === undefined) setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  };

  // A parked drawer is off screen: keep it out of the tab order. On desktop the rail is the page.
  useEffect(() => {
    setDrawerPanelInert(panelRef.current, phone && !isOpen);
  }, [phone, isOpen]);

  // Focus moves into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    if (drawerOpen === previousOpen.current) return;
    previousOpen.current = drawerOpen;
    if (drawerOpen) {
      panelRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || panelRef.current?.contains(active)) {
      triggerRef.current?.focus();
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const release = lockBodyScroll();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      release();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen, setOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab' && drawerOpen) trapDrawerTab(panelRef.current, panelRef.current, event);
  };

  const visible = items.filter(isShown);
  const current = activeItem(visible);
  const rail = collapsible && isCollapsed && !phone;
  // Following a link on a phone closes the drawer; the page behind is the destination.
  const onNavigate = () => {
    if (phone && isOpen) setOpen(false);
  };

  return (
    <div
      className={cx('side-nav', className)}
      data-collapsed={rail || undefined}
      data-state={isOpen ? 'open' : 'closed'}
    >
      {!hideMobileTrigger && (
        <button
          ref={triggerRef}
          type="button"
          className="side-nav-trigger"
          aria-expanded={drawerOpen}
          aria-controls={panelId}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
          <span className="sr-only">Open menu:</span>{' '}
          <span className="side-nav-trigger-label">{mobileTriggerLabel ?? current?.label ?? ariaLabel}</span>
        </button>
      )}
      {drawerOpen && <div className="side-nav-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div
        ref={panelRef}
        id={panelId}
        className="side-nav-panel"
        role={phone ? 'dialog' : undefined}
        aria-modal={drawerOpen || undefined}
        aria-label={phone ? ariaLabel : undefined}
        aria-hidden={(phone && !isOpen) || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {phone && (
          <div className="side-nav-drawer-bar">
            <button type="button" className="side-nav-icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </div>
        )}
        {header !== undefined && !rail && <div className="side-nav-header">{header}</div>}
        <nav className="side-nav-body" aria-label={ariaLabel}>
          {groupBySection(visible).map((group, index) => (
            <div className="side-nav-section" key={group.section ?? `__ungrouped-${index}`}>
              {group.section && !rail && <span className="side-nav-section-title">{group.section}</span>}
              <ul className="side-nav-list">
                {group.items.map((item) => (
                  <SideNavEntry
                    key={item.id}
                    item={item}
                    rail={rail}
                    linkComponent={linkComponent}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {footer !== undefined && !rail && <div className="side-nav-footer">{footer}</div>}
        {collapsible && !phone && (
          <button
            type="button"
            className="side-nav-collapse-btn"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!isCollapsed}
            aria-controls={panelId}
            onClick={() => setCollapsed(!isCollapsed)}
          >
            <ChevronIcon />
            {!rail && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

function SideNavEntry({
  item,
  rail,
  linkComponent,
  onNavigate
}: {
  item: SideNavItem;
  rail: boolean;
  linkComponent?: AppNavLinkComponent;
  onNavigate: () => void;
}) {
  const children = (item.items ?? []).filter(isShown);
  const isGroup = children.length > 0;
  const containsActive = isGroup && holdsActive(item) && !item.active;
  const [expanded, setExpanded] = useState(item.defaultExpanded ?? containsActive);
  const subId = `${useId()}-group`;

  // Landing on a page inside a closed group opens it.
  useEffect(() => {
    if (containsActive) setExpanded(true);
  }, [containsActive]);

  // A closed group (or one in the rail) wears its first child's badge, so a count never hides.
  const shownBadge =
    isGroup && !hasBadge(item) && (rail || !expanded) ? (children.find(hasBadge) ?? item) : item;

  const content = (
    <>
      {item.icon !== undefined && (
        <span className="side-nav-icon" aria-hidden="true">
          {item.icon}
        </span>
      )}
      <span className="side-nav-label">{item.label}</span>
      {/* A space between, so the badge reads as its own word ("Trades 2 offers waiting"). */}
      {hasBadge(shownBadge) && ' '}
      <SideNavBadge item={shownBadge} />
    </>
  );
  const linkClass = cx(
    'side-nav-link',
    (item.active || (rail && containsActive)) && 'side-nav-link-active',
    containsActive && 'side-nav-link-within'
  );

  // The rail has no room for a group: it links to the group's first page.
  const href = rail ? railHref(item) : item.href;

  if (rail || !isGroup) {
    return (
      <li className="side-nav-item">
        {href !== undefined ? (
          <SideNavAnchor
            href={href}
            className={linkClass}
            external={item.external}
            ariaCurrent={item.active ? 'page' : undefined}
            title={rail ? item.label : undefined}
            linkComponent={linkComponent}
            onClick={onNavigate}
          >
            {content}
          </SideNavAnchor>
        ) : (
          <span className={linkClass}>{content}</span>
        )}
      </li>
    );
  }

  const toggle = (
    <button
      type="button"
      className={cx('side-nav-group-toggle', item.href === undefined && linkClass)}
      aria-expanded={expanded}
      aria-controls={subId}
      aria-label={item.href !== undefined ? `${expanded ? 'Collapse' : 'Expand'} ${item.label}` : undefined}
      onClick={() => setExpanded(!expanded)}
    >
      {item.href === undefined && content}
      <ChevronIcon />
    </button>
  );

  return (
    <li className="side-nav-item side-nav-group" data-expanded={expanded || undefined}>
      <div className="side-nav-group-row">
        {item.href !== undefined ? (
          <>
            <SideNavAnchor
              href={item.href}
              className={linkClass}
              external={item.external}
              ariaCurrent={item.active ? 'page' : undefined}
              linkComponent={linkComponent}
              onClick={onNavigate}
            >
              {content}
            </SideNavAnchor>
            {toggle}
          </>
        ) : (
          toggle
        )}
      </div>
      <ul className="side-nav-list side-nav-sublist" id={subId} hidden={!expanded}>
        {children.map((child) => (
          <SideNavEntry
            key={child.id}
            item={child}
            rail={false}
            linkComponent={linkComponent}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </li>
  );
}

function hasBadge(item: SideNavItem): boolean {
  return item.badge !== undefined && item.badge !== 0 && item.badge !== '';
}

function SideNavBadge({ item }: { item: SideNavItem }) {
  const { badge } = item;
  if (!hasBadge(item)) return null;
  return (
    <span className={cx('side-nav-badge', `side-nav-badge-${item.badgeTone ?? 'primary'}`)}>
      <span aria-hidden={item.badgeLabel !== undefined || undefined}>{badge}</span>
      {item.badgeLabel !== undefined && <span className="sr-only">{item.badgeLabel}</span>}
    </span>
  );
}

function SideNavAnchor({
  href,
  className,
  external,
  ariaCurrent,
  title,
  linkComponent: LinkComponent,
  onClick,
  children
}: {
  href: string;
  className?: string;
  external?: boolean;
  ariaCurrent?: 'page';
  title?: string;
  linkComponent?: AppNavLinkComponent;
  onClick: () => void;
  children: ReactNode;
}) {
  if (LinkComponent && !external) {
    // The router link gets the click through a wrapper: AppNavLinkProps carries no onClick.
    return (
      <span className="side-nav-anchor" onClickCapture={onClick}>
        <LinkComponent href={href} className={className} aria-current={ariaCurrent} title={title}>
          {children}
        </LinkComponent>
      </span>
    );
  }
  return (
    <a
      className={className}
      href={href}
      aria-current={ariaCurrent}
      title={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/**
 * The page beside a `SideNav`: the nav in its column and the page in the rest.
 * On a phone the nav's menu button sits above the page and the rail is gone.
 */
export function SideNavLayout({
  nav,
  children,
  className
}: {
  nav: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('side-nav-layout', className)}>
      {nav}
      <div className="side-nav-layout-main">{children}</div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
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

function ChevronIcon() {
  return (
    <svg className="side-nav-chevron" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z" />
    </svg>
  );
}
