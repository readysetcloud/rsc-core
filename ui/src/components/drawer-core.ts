/*
 * Framework-agnostic drawer behavior. The React <Drawer> and the vanilla
 * enhanceDrawers() both build on this, so a Hugo page and a React page trap
 * focus, lock scroll, and park a closed panel out of the tab order the same
 * way. Markup/classes live in styles/components.css; this is the behavior.
 */

export const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab stops inside a drawer, in DOM order — the tab button comes first. */
export function drawerFocusStops(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)];
}

/** The bits of a keyboard event the Tab trap needs — React's or the DOM's. */
interface TabEvent {
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Wraps Tab around the drawer so a modal one can't hand focus to the page
 * behind it. No-op when focus is mid-cycle; the browser moves it as usual.
 */
export function trapDrawerTab(
  root: HTMLElement | null | undefined,
  panel: HTMLElement | null | undefined,
  event: TabEvent
): void {
  const stops = drawerFocusStops(root);
  if (!stops.length) {
    // Nothing to land on — keep focus on the panel rather than let it escape.
    event.preventDefault();
    panel?.focus();
    return;
  }

  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;

  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Toggles the panel's inert state. Set imperatively rather than as a React
 * prop: React 19 wants inert={true} but React 18 silently drops a boolean on
 * a non-boolean attribute, which would leave a closed panel in the tab order.
 */
export function setDrawerPanelInert(panel: HTMLElement | null | undefined, inert: boolean): void {
  panel?.toggleAttribute('inert', inert);
}

// Ref-counted so two modal drawers can't strand the page: whoever locks last
// would otherwise "restore" the hidden value the first one set.
let scrollLocks = 0;
let scrollRestore: { overflow: string; paddingRight: string } | null = null;

/**
 * Locks body scroll and pads out the scrollbar gutter so the page doesn't
 * shift sideways. Returns the release; the last one out restores the page.
 */
export function lockBodyScroll(): () => void {
  const body = document.body;

  if (scrollLocks === 0) {
    scrollRestore = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gutter > 0) {
      const existing = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${existing + gutter}px`;
    }
  }
  scrollLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks -= 1;
    if (scrollLocks === 0 && scrollRestore) {
      body.style.overflow = scrollRestore.overflow;
      body.style.paddingRight = scrollRestore.paddingRight;
      scrollRestore = null;
    }
  };
}
