import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Drawer } from './Drawer';

afterEach(cleanup);

const root = () => document.querySelector('.drawer') as HTMLElement;

describe('Drawer', () => {
  it('renders the tab and children, closed by default', () => {
    render(<Drawer tabLabel="Filters">Panel contents</Drawer>);

    const tab = screen.getByRole('button', { name: /filters/i });
    expect(tab.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Panel contents')).toBeDefined();
    expect(root().dataset.state).toBe('closed');
    expect(root().dataset.side).toBe('right');
  });

  it('toggles open and closed from the tab', () => {
    render(<Drawer tabLabel="Filters">Panel contents</Drawer>);
    const tab = screen.getByRole('button', { name: /filters/i });

    fireEvent.click(tab);
    expect(root().dataset.state).toBe('open');
    expect(tab.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(tab);
    expect(root().dataset.state).toBe('closed');
  });

  it('wires the tab to the panel and keeps the closed panel out of the a11y tree', () => {
    render(<Drawer tabLabel="Filters" title="Filters">Panel contents</Drawer>);

    const tab = screen.getByRole('button', { name: /filters/i });
    const panel = document.getElementById(tab.getAttribute('aria-controls') as string);
    expect(panel?.classList.contains('drawer-panel')).toBe(true);
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.hasAttribute('inert')).toBe(true);
    expect(panel?.getAttribute('aria-label')).toBe('Filters');

    fireEvent.click(tab);
    expect(panel?.hasAttribute('aria-hidden')).toBe(false);
    expect(panel?.hasAttribute('inert')).toBe(false);
  });

  it.each(['left', 'right', 'top', 'bottom'] as const)('docks to the %s edge', (side) => {
    render(
      <Drawer tabLabel="Filters" side={side} align="start" size="30rem">
        Panel contents
      </Drawer>
    );

    expect(root().dataset.side).toBe(side);
    expect(root().dataset.align).toBe('start');
    expect(root().style.getPropertyValue('--rsc-drawer-size')).toBe('30rem');
  });

  it('stays controlled when `open` is supplied', () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer tabLabel="Filters" open={false} onOpenChange={onOpenChange}>
        Panel contents
      </Drawer>
    );

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(root().dataset.state).toBe('closed');
  });

  it('closes on Escape from inside the drawer', () => {
    render(
      <Drawer tabLabel="Filters" defaultOpen>
        Panel contents
      </Drawer>
    );
    expect(root().dataset.state).toBe('open');

    fireEvent.keyDown(screen.getByText('Panel contents'), { key: 'Escape' });
    expect(root().dataset.state).toBe('closed');
  });

  it('renders a scrim in modal mode that closes on click, and locks body scroll', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer tabLabel="Filters" modal open={open} onOpenChange={setOpen}>
          Panel contents
        </Drawer>
      );
    }
    render(<Harness />);

    const scrim = document.querySelector('.drawer-scrim') as HTMLElement;
    expect(scrim).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    // lifts the modal drawer above the scrim; plain drawers stay beneath it
    expect(root().classList.contains('drawer-modal')).toBe(true);

    fireEvent.click(scrim);
    expect(document.querySelector('.drawer-scrim')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the scroll lock ref-counted across two modal drawers', () => {
    function Two() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setA(!a)}>toggle A</button>
          <button type="button" onClick={() => setB(!b)}>toggle B</button>
          <Drawer tabLabel="A" modal open={a} onOpenChange={setA}>A body</Drawer>
          <Drawer tabLabel="B" modal open={b} onOpenChange={setB}>B body</Drawer>
        </>
      );
    }
    render(<Two />);

    fireEvent.click(screen.getByText('toggle A'));
    fireEvent.click(screen.getByText('toggle B'));
    expect(document.body.style.overflow).toBe('hidden');

    // one closing must not unlock the page while the other is still open...
    fireEvent.click(screen.getByText('toggle A'));
    expect(document.body.style.overflow).toBe('hidden');

    // ...and the last one out restores the page, not the locked value
    fireEvent.click(screen.getByText('toggle B'));
    expect(document.body.style.overflow).toBe('');
  });

  it('closes a modal drawer on Escape from anywhere on the page', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer tabLabel="Filters" modal open={open} onOpenChange={setOpen}>
          Panel contents
        </Drawer>
      );
    }
    render(<Harness />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(root().dataset.state).toBe('closed');
  });

  it('keeps Tab inside a modal drawer and lets it leave a plain one', () => {
    const { unmount } = render(
      <Drawer tabLabel="Filters" modal defaultOpen>
        <button type="button">Apply</button>
      </Drawer>
    );

    const tab = screen.getByRole('button', { name: /filters/i });
    const apply = screen.getByRole('button', { name: 'Apply' });

    // forward off the last stop wraps to the tab, backward off the tab wraps to the last
    apply.focus();
    fireEvent.keyDown(apply, { key: 'Tab' });
    expect(document.activeElement).toBe(tab);

    fireEvent.keyDown(tab, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(apply);
    unmount();

    render(
      <Drawer tabLabel="Filters" defaultOpen>
        <button type="button">Apply</button>
      </Drawer>
    );
    const plainApply = screen.getByRole('button', { name: 'Apply' });
    plainApply.focus();
    fireEvent.keyDown(plainApply, { key: 'Tab' });
    expect(document.activeElement).toBe(plainApply);
  });

  it('renders no header when no title is given', () => {
    render(
      <Drawer tabLabel="Filters" defaultOpen>
        Panel contents
      </Drawer>
    );

    expect(document.querySelector('.drawer-header')).toBeNull();
    expect(screen.queryByRole('button', { name: /close drawer/i })).toBeNull();
  });

  it('closes from the header close button', () => {
    render(
      <Drawer tabLabel="Filters" title="Recent activity" defaultOpen>
        Panel contents
      </Drawer>
    );
    expect(screen.getByText('Recent activity')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /close drawer/i }));
    expect(root().dataset.state).toBe('closed');
  });

  it('can hide the tab for app-driven drawers', () => {
    render(
      <Drawer tabLabel="Filters" hideTab open>
        Panel contents
      </Drawer>
    );

    expect(screen.queryByRole('button', { name: /filters/i })).toBeNull();
    expect(root().dataset.state).toBe('open');
  });

  it('moves focus into the panel on open and back to the tab on close', () => {
    render(<Drawer tabLabel="Filters">Panel contents</Drawer>);
    const tab = screen.getByRole('button', { name: /filters/i });

    fireEvent.click(tab);
    const panel = document.getElementById(tab.getAttribute('aria-controls') as string);
    expect(document.activeElement).toBe(panel);

    fireEvent.click(tab);
    expect(document.activeElement).toBe(tab);
  });
});
