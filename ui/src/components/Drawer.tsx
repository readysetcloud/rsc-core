import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { lockBodyScroll, setDrawerPanelInert, trapDrawerTab } from './drawer-core';

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom';
/** Where the tab sits along the edge it is docked to. */
export type DrawerAlign = 'start' | 'center' | 'end';
export type DrawerTabTone = 'primary' | 'neutral';
export type DrawerTitleTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface DrawerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** Drawer contents. Rendered inside the scrollable body. */
  children: ReactNode;
  /** Edge the drawer is docked to (default `right`). */
  side?: DrawerSide;
  /** Tab position along that edge (default `center`). */
  align?: DrawerAlign;
  /**
   * Tab text. Reads bottom-to-top on the left edge, top-to-bottom on the
   * right. Optional: omit it for an icon-only tab (which then takes its
   * accessible name from `aria-label` or a string `title`), or with `hideTab`.
   */
  tabLabel?: ReactNode;
  /** Optional glyph rendered before the tab label. */
  tabIcon?: ReactNode;
  tabTone?: DrawerTabTone;
  /** Hide the tab when the app drives `open` from its own control. */
  hideTab?: boolean;
  /** Panel width (left/right) or height (top/bottom) as a CSS length. Default `22rem`. */
  size?: string;
  /** Controlled open state. Omit to let the drawer own it. */
  open?: boolean;
  /** Initial state when uncontrolled (default false). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Dim the page behind the panel, lock body scroll, and close on scrim click. */
  modal?: boolean;
  /** Renders a header with the title and a close button. */
  title?: ReactNode;
  /** Heading level for `title` — match the page's outline (default `h2`). */
  titleAs?: DrawerTitleTag;
  /** Class for the sliding panel (the root gets `className`). */
  panelClassName?: string;
  /**
   * Class for the scrollable body. Use it to drop the default padding, or to
   * set `overflow: visible` when the contents host a popover and don't scroll.
   */
  bodyClassName?: string;
  tabClassName?: string;
  /** Accessible name for the panel. Falls back to a string `title`. */
  'aria-label'?: string;
}

/**
 * Edge drawer with an always-visible tab: the tab rides with the panel, so the
 * whole assembly slides by exactly the panel's extent and the handle stays on
 * screen. Dockable to any side; consumers own the contents.
 *
 * Uncontrolled by default (`defaultOpen`); pass `open` + `onOpenChange` to
 * drive it. Esc closes when focus is inside, or anywhere when `modal`.
 */
export function Drawer({
  children,
  side = 'right',
  align = 'center',
  tabLabel,
  tabIcon,
  tabTone = 'primary',
  hideTab = false,
  size = '22rem',
  open,
  defaultOpen = false,
  onOpenChange,
  modal = false,
  title,
  titleAs: TitleTag = 'h2',
  className,
  panelClassName,
  bodyClassName,
  tabClassName,
  'aria-label': ariaLabel,
  onKeyDown,
  style,
  ...rest
}: DrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;

  const panelId = `${useId()}-drawer`;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(isOpen);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  // Must run before the focus effect below — focus can't enter an inert tree.
  useEffect(() => {
    setDrawerPanelInert(panelRef.current, !isOpen);
  }, [isOpen]);

  // Move focus into the panel when it opens, and hand it back to the tab when
  // it closes — but only if focus was still inside, so a programmatic close
  // never yanks the caret out of whatever the user is typing in.
  useEffect(() => {
    if (isOpen === previousOpen.current) return;
    previousOpen.current = isOpen;

    if (isOpen) {
      panelRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || panelRef.current?.contains(active)) {
      tabRef.current?.focus();
    }
  }, [isOpen]);

  // A modal drawer owns Esc for the whole page; a plain one only handles it
  // when focus is inside (see onKeyDown below) so it can't swallow an app's
  // own Esc handling while it sits there peeking out of the edge.
  useEffect(() => {
    if (!modal || !isOpen) return;
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [modal, isOpen, setOpen]);

  useEffect(() => {
    if (!modal || !isOpen) return;
    return lockBodyScroll();
  }, [modal, isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      setOpen(false);
      return;
    }

    // A modal drawer says aria-modal, so Tab has to stay inside it (the tab
    // button counts — it's how you close). Non-modal drawers are part of the
    // page and let Tab walk straight out.
    if (event.key === 'Tab' && modal && isOpen) {
      trapDrawerTab(rootRef.current, panelRef.current, event);
    }
  };

  const panelLabel = ariaLabel ?? (typeof title === 'string' ? title : undefined);

  const content = (
    <>
      {modal && isOpen && (
        <div className="drawer-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      )}
      <div
        ref={rootRef}
        className={cx('drawer', modal && 'drawer-modal', className)}
        data-side={side}
        data-align={align}
        data-state={isOpen ? 'open' : 'closed'}
        style={{ ...style, '--rsc-drawer-size': size } as CSSProperties}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        {!hideTab && (
          <button
            ref={tabRef}
            type="button"
            className={cx('drawer-tab', `drawer-tab-${tabTone}`, tabClassName)}
            aria-expanded={isOpen}
            aria-controls={panelId}
            // An icon-only tab has no text to name it — borrow the panel's.
            aria-label={tabLabel === undefined ? panelLabel ?? 'Toggle drawer' : undefined}
            onClick={() => setOpen(!isOpen)}
          >
            {tabIcon && (
              <span className="drawer-tab-icon" aria-hidden="true">
                {tabIcon}
              </span>
            )}
            {tabLabel !== undefined && <span className="drawer-tab-label">{tabLabel}</span>}
            <svg className="drawer-tab-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <div
          ref={panelRef}
          id={panelId}
          className={cx('drawer-panel', panelClassName)}
          role="dialog"
          aria-modal={modal || undefined}
          aria-hidden={!isOpen || undefined}
          aria-label={panelLabel}
          tabIndex={-1}
        >
          {title !== undefined && (
            <div className="drawer-header">
              <TitleTag className="drawer-title">{title}</TitleTag>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setOpen(false)}
                aria-label="Close drawer"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}
          <div className={cx('drawer-body', bodyClassName)}>{children}</div>
        </div>
      </div>
    </>
  );

  // Portal to the body so a transformed ancestor can't break `position: fixed`.
  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
