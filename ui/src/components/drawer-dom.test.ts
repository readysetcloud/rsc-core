import { afterEach, describe, expect, it } from 'vitest';
import { enhanceDrawer, enhanceDrawers } from './drawer-dom';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

function mount(attrs = '') {
  document.body.innerHTML = `
    <div class="drawer" data-side="right" data-align="center" ${attrs}>
      <button class="drawer-tab" aria-expanded="false" aria-controls="p1">Filters</button>
      <div class="drawer-panel" id="p1" role="dialog" aria-label="Filters" tabindex="-1">
        <div class="drawer-header">
          <h2 class="drawer-title">Filters</h2>
          <button class="drawer-close" aria-label="Close drawer">x</button>
        </div>
        <div class="drawer-body"><button id="apply">Apply</button></div>
      </div>
    </div>`;
  return {
    root: document.querySelector<HTMLElement>('.drawer')!,
    tab: document.querySelector<HTMLButtonElement>('.drawer-tab')!,
    panel: document.querySelector<HTMLElement>('.drawer-panel')!
  };
}

describe('enhanceDrawers', () => {
  it('adopts the markup state and parks the closed panel out of the tab order', () => {
    const { root, tab, panel } = mount();
    enhanceDrawers();

    expect(root.dataset.state).toBe('closed');
    expect(tab.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('toggles from the tab, the close button, and the controller', () => {
    const { root, tab, panel } = mount();
    const [drawer] = enhanceDrawers();

    tab.click();
    expect(root.dataset.state).toBe('open');
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('aria-hidden')).toBe(false);
    expect(document.activeElement).toBe(panel);

    document.querySelector<HTMLButtonElement>('.drawer-close')!.click();
    expect(root.dataset.state).toBe('closed');
    expect(document.activeElement).toBe(tab);

    drawer!.open();
    expect(drawer!.isOpen()).toBe(true);
    drawer!.toggle();
    expect(drawer!.isOpen()).toBe(false);
  });

  it('closes on Escape from inside', () => {
    const { root, tab, panel } = mount();
    enhanceDrawers();
    tab.click();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.dataset.state).toBe('closed');
  });

  it('adds a scrim and locks scroll only for data-modal drawers', () => {
    const { root, tab } = mount('data-modal');
    enhanceDrawers();
    expect(root.classList.contains('drawer-modal')).toBe(true);

    tab.click();
    const scrim = document.querySelector<HTMLElement>('.drawer-scrim');
    expect(scrim).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    scrim!.click();
    expect(root.dataset.state).toBe('closed');
    expect(document.querySelector('.drawer-scrim')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes a modal drawer on Escape from anywhere, a plain one only from inside', () => {
    const modal = mount('data-modal');
    enhanceDrawers();
    modal.tab.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.root.dataset.state).toBe('closed');

    const plain = mount();
    enhanceDrawers();
    plain.tab.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(plain.root.dataset.state).toBe('open');
  });

  it('keeps Tab inside an open modal drawer', () => {
    const { tab } = mount('data-modal');
    enhanceDrawers();
    tab.click();

    const apply = document.getElementById('apply') as HTMLButtonElement;
    apply.focus();
    apply.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(tab);
  });

  it('is idempotent and unbinds on destroy', () => {
    const { root, tab } = mount();
    const first = enhanceDrawer(root);
    expect(enhanceDrawer(root)).toBe(first);
    expect(enhanceDrawers()).toHaveLength(1);

    tab.click();
    expect(root.dataset.state).toBe('open');

    first.destroy();
    tab.click();
    expect(root.dataset.state).toBe('open'); // listener gone, state unchanged
  });

  it('only claims elements that carry the drawer data attributes', () => {
    document.body.innerHTML = '<div class="drawer">someone else\'s drawer</div>';
    expect(enhanceDrawers()).toHaveLength(0);
  });
});
