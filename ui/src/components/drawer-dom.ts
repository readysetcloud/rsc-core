/*
 * Progressive enhancement for drawers written as plain markup — the Hugo site
 * and the static course pages. The page owns the HTML (same classes the React
 * <Drawer> renders); this wires the behavior: toggle, Esc, scrim, scroll lock,
 * inert, focus. Behavior primitives are shared with React via drawer-core.
 *
 *   <div class="drawer" data-side="right" data-align="center" data-state="closed">
 *     <button class="drawer-tab drawer-tab-primary" aria-expanded="false" aria-controls="filters">…</button>
 *     <div class="drawer-panel" id="filters" role="dialog" aria-label="Filters" tabindex="-1" inert>…</div>
 *   </div>
 *   <script>rscUi.enhanceDrawers();</script>
 *
 * Add data-modal to dim the page, lock scroll, and keep Tab inside.
 */

import { lockBodyScroll, setDrawerPanelInert, trapDrawerTab } from './drawer-core';

export interface DrawerController {
  /** The `.drawer` element this controller drives. */
  element: HTMLElement;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Unbind listeners and drop any scrim/scroll lock. Leaves the markup. */
  destroy: () => void;
}

const controllers = new WeakMap<HTMLElement, DrawerController>();

/**
 * Wires one drawer element. Calling it twice on the same element returns the
 * existing controller rather than double-binding.
 */
export function enhanceDrawer(element: HTMLElement): DrawerController {
  const existing = controllers.get(element);
  if (existing) return existing;

  const tab = element.querySelector<HTMLButtonElement>('.drawer-tab');
  const panel = element.querySelector<HTMLElement>('.drawer-panel');
  const closeButton = element.querySelector<HTMLButtonElement>('.drawer-close');
  const modal = element.hasAttribute('data-modal');

  let scrim: HTMLElement | null = null;
  let releaseScroll: (() => void) | null = null;

  const isOpen = () => element.dataset.state === 'open';

  const setState = (next: boolean) => {
    if (next === isOpen()) return;

    element.dataset.state = next ? 'open' : 'closed';
    tab?.setAttribute('aria-expanded', String(next));
    setDrawerPanelInert(panel, !next);
    if (next) panel?.removeAttribute('aria-hidden');
    else panel?.setAttribute('aria-hidden', 'true');

    if (modal) {
      if (next) {
        scrim = document.createElement('div');
        scrim.className = 'drawer-scrim';
        scrim.setAttribute('aria-hidden', 'true');
        scrim.addEventListener('click', () => setState(false));
        element.parentNode?.insertBefore(scrim, element);
        releaseScroll = lockBodyScroll();
      } else {
        scrim?.remove();
        scrim = null;
        releaseScroll?.();
        releaseScroll = null;
      }
    }

    // Same focus contract as React: into the panel on open, back to the tab on
    // close — but only when focus was still inside, so a programmatic close
    // can't yank the caret out of whatever the user is typing in.
    if (next) {
      panel?.focus();
    } else {
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active)) tab?.focus();
    }
  };

  const onTabClick = () => setState(!isOpen());
  const onCloseClick = () => setState(false);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isOpen() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setState(false);
      return;
    }
    if (event.key === 'Tab' && modal) trapDrawerTab(element, panel, event);
  };

  // A modal drawer owns Esc for the whole page; a plain one only sees the
  // keydown that bubbles out of itself, so it can't swallow the page's own Esc.
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen()) setState(false);
  };

  tab?.addEventListener('click', onTabClick);
  closeButton?.addEventListener('click', onCloseClick);
  element.addEventListener('keydown', onKeyDown);
  if (modal) document.addEventListener('keydown', onDocumentKeyDown);

  // Adopt whatever state the markup shipped with, syncing every attribute a
  // hand-written page is likely to have left off.
  if (!element.dataset.state) element.dataset.state = 'closed';
  if (modal) element.classList.add('drawer-modal');
  setDrawerPanelInert(panel, !isOpen());
  tab?.setAttribute('aria-expanded', String(isOpen()));
  if (isOpen()) panel?.removeAttribute('aria-hidden');
  else panel?.setAttribute('aria-hidden', 'true');

  const controller: DrawerController = {
    element,
    isOpen,
    open: () => setState(true),
    close: () => setState(false),
    toggle: () => setState(!isOpen()),
    destroy() {
      tab?.removeEventListener('click', onTabClick);
      closeButton?.removeEventListener('click', onCloseClick);
      element.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
      scrim?.remove();
      scrim = null;
      releaseScroll?.();
      releaseScroll = null;
      controllers.delete(element);
    }
  };

  controllers.set(element, controller);
  return controller;
}

/**
 * Enhances every `.drawer` under `root` (the document by default). Safe to
 * call again after adding markup — already-wired drawers are left alone.
 */
export function enhanceDrawers(root: ParentNode = document): DrawerController[] {
  return [...root.querySelectorAll<HTMLElement>('.drawer[data-side]')].map(enhanceDrawer);
}
