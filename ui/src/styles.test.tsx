/**
 * Cascade checks for the shipped stylesheets. jsdom resolves selector
 * specificity and source order in getComputedStyle, so these load the real
 * base.css + components.css (in index.css order) and assert what a browser
 * would compute. jsdom doesn't evaluate media queries, so the phone checks
 * lift the `max-width: 768px` rules into their own sheet to stand in for a
 * phone viewport.
 */
/// <reference types="vite/client" />
import baseCss from '../styles/base.css?raw';
import componentsCss from '../styles/components.css?raw';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Drawer, type DrawerSide } from './components/Drawer';
import { enhanceDrawers } from './components/drawer-dom';
import { SegmentedControl } from './components/SegmentedControl';
import { ToastProvider, useToast } from './components/Toast';
import { PasswordInput } from './components/Input';
import { ResendCodeButton } from './auth/components/ResendCodeButton';
import { useEffect } from 'react';

const PACKAGE_CSS = `${baseCss}\n${componentsCss}`;
// What Tailwind v3's preflight does to fields; it loads after our stylesheet.
const PREFLIGHT_CSS = 'button, input, optgroup, select, textarea { font-size: 100%; }';
const SIDES: DrawerSide[] = ['left', 'right', 'top', 'bottom'];

function addSheet(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/**
 * Rewrite every loaded sheet with the phone breakpoint's rules unwrapped in
 * place, so they apply with their real source order and specificity.
 */
function emulatePhone() {
  let unwrapped = 0;
  for (const style of Array.from(document.head.querySelectorAll('style'))) {
    const sheet = style.sheet as CSSStyleSheet;
    const text = Array.from(sheet.cssRules)
      .map((rule) => {
        if (rule instanceof CSSMediaRule && rule.conditionText.replace(/\s+/g, '') === '(max-width:768px)') {
          unwrapped++;
          return Array.from(rule.cssRules).map((inner) => inner.cssText).join('\n');
        }
        return rule.cssText;
      })
      .join('\n');
    style.textContent = text;
  }
  expect(unwrapped).toBeGreaterThan(0);
}

const zIndex = (el: Element | null) => Number(getComputedStyle(el as Element).zIndex);

beforeEach(() => {
  addSheet(PACKAGE_CSS);
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

describe('drawer stacking', () => {
  it.each(SIDES)('keeps an open modal %s drawer above its scrim', (side) => {
    render(
      <Drawer side={side} tabLabel="Filters" modal defaultOpen>
        Panel
      </Drawer>
    );
    const scrim = document.querySelector('.drawer-scrim');
    const drawer = document.querySelector('.drawer');
    expect(scrim).not.toBeNull();
    expect(zIndex(drawer)).toBeGreaterThan(zIndex(scrim));
  });

  it('keeps a plain drawer below a modal drawer\'s scrim', () => {
    render(
      <>
        <Drawer side="left" tabLabel="Help">Help</Drawer>
        <Drawer side="right" tabLabel="Filters" modal defaultOpen>Filters</Drawer>
      </>
    );
    const [plain] = Array.from(document.querySelectorAll('.drawer:not(.drawer-modal)'));
    expect(zIndex(plain ?? null)).toBeLessThan(zIndex(document.querySelector('.drawer-scrim')));
  });

  it.each(SIDES)('keeps an enhanced data-modal %s drawer above its scrim', (side) => {
    document.body.innerHTML = `
      <div class="drawer" data-side="${side}" data-state="closed" data-modal>
        <button class="drawer-tab" aria-expanded="false" aria-controls="p">Filters</button>
        <div class="drawer-panel" id="p" role="dialog" aria-label="Filters" tabindex="-1"></div>
      </div>`;
    const [controller] = enhanceDrawers();
    controller?.open();
    expect(zIndex(document.querySelector('.drawer'))).toBeGreaterThan(
      zIndex(document.querySelector('.drawer-scrim'))
    );
    controller?.destroy();
  });
});

describe('page overflow', () => {
  it('leaves html and body unclipped so sticky works and wide content stays reachable', () => {
    for (const el of [document.documentElement, document.body]) {
      const style = getComputedStyle(el);
      expect(style.overflowX).not.toBe('hidden');
      expect(style.overflowX).not.toBe('clip');
      expect(style.overflowY).not.toBe('hidden');
    }
  });
});

describe('phone sizing (max-width: 768px)', () => {
  function Toaster() {
    const { toast } = useToast();
    useEffect(() => toast('Saved'), [toast]);
    return null;
  }

  it('gives .input fields 16px text and a 44px target', () => {
    document.body.innerHTML = `
      <div style="font-size: 12px">
        <input class="input" type="email">
        <input class="input">
        <textarea class="input"></textarea>
        <select class="input"></select>
      </div>`;
    addSheet(PREFLIGHT_CSS);
    emulatePhone();
    for (const field of Array.from(document.querySelectorAll('.input'))) {
      const style = getComputedStyle(field);
      expect(style.fontSize).toBe('16px');
      expect(style.minHeight).toBe('44px');
    }
  });

  it('keeps bare fields at 16px after a later preflight reset', () => {
    document.body.innerHTML = `
      <div style="font-size: 12px">
        <input><input type="search"><input type="date"><textarea></textarea><select></select>
      </div>`;
    addSheet(PREFLIGHT_CSS);
    emulatePhone();
    for (const field of Array.from(document.querySelectorAll('input, textarea, select'))) {
      expect(getComputedStyle(field).fontSize).toBe('16px');
    }
  });

  it('gives segmented control options a 44px target', () => {
    render(
      <SegmentedControl
        aria-label="Range"
        value="week"
        onChange={() => {}}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' }
        ]}
      />
    );
    emulatePhone();
    for (const option of Array.from(document.querySelectorAll('.segmented-control-option'))) {
      expect(getComputedStyle(option).minHeight).toBe('44px');
    }
  });

  it('gives the toast dismiss button a 44px target with no inline override', async () => {
    await act(async () => {
      render(
        <ToastProvider>
          <Toaster />
        </ToastProvider>
      );
    });
    emulatePhone();
    const dismiss = document.querySelector('[aria-label="Dismiss notification"]') as HTMLElement;
    expect(dismiss).not.toBeNull();
    expect(dismiss.getAttribute('style')).toBeNull();
    const style = getComputedStyle(dismiss);
    expect(style.minHeight).toBe('44px');
    expect(style.minWidth).toBe('44px');
  });

  it('gives the password Show/Hide toggle a 44px target inside the field', () => {
    render(<PasswordInput label="Password" />);
    emulatePhone();
    const toggle = document.querySelector('[aria-label="Show password"]') as HTMLElement;
    expect(toggle.getAttribute('style')).toBeNull();
    const style = getComputedStyle(toggle);
    expect(style.minHeight).toBe('44px');
    expect(style.minWidth).toBe('44px');
    expect(style.position).toBe('absolute');
    // The field reserves more room than the toggle takes, so text never runs under it.
    const input = document.querySelector('.password-field > .input') as HTMLElement;
    expect(input.getAttribute('style')).toBeNull();
    expect(getComputedStyle(input).paddingRight).toBe('3.25rem');
  });

  it('gives the Resend code button a 44px target with no inline override', () => {
    render(<ResendCodeButton email="a@example.com" onResend={async () => {}} />);
    emulatePhone();
    const button = document.querySelector('.auth-text-button') as HTMLElement;
    expect(button.getAttribute('style')).toBeNull();
    expect(getComputedStyle(button).minHeight).toBe('44px');
  });
});
