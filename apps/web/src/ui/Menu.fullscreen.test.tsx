import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, Menu, type MenuAction } from '@/ui';

const actions: MenuAction[] = [{ label: 'Umbenennen', icon: 'edit', onSelect: vi.fn() }];

/** Makes `element` the fullscreen element, as `requestFullscreen()` would (F in the viewer). */
function enterFullscreen(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
}

afterEach(() => enterFullscreen(null));

function fullscreenRoot(): Element {
  const { container } = render(<div data-viewer-root />);
  const root = container.querySelector('[data-viewer-root]')!;
  enterFullscreen(root);
  return root;
}

// Only the fullscreen element's subtree is drawn: a menu in `<body>` would be invisible.
describe('menus in fullscreen', () => {
  it('a right-click menu opens inside the fullscreen element', () => {
    const root = fullscreenRoot();
    render(
      <ContextMenu label="Kommentar" actions={actions} at={{ x: 10, y: 10 }} onClose={vi.fn()} />,
    );
    expect(root.contains(screen.getByRole('menu', { name: 'Kommentar' }))).toBe(true);
  });

  it('a menu button’s menu does too', async () => {
    const root = fullscreenRoot();
    render(<Menu label="Aktionen" actions={actions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    expect(root.contains(screen.getByRole('menu', { name: 'Aktionen' }))).toBe(true);
  });

  it('otherwise they go into <body>', () => {
    render(
      <ContextMenu label="Kommentar" actions={actions} at={{ x: 10, y: 10 }} onClose={vi.fn()} />,
    );
    const menu = screen.getByRole('menu', { name: 'Kommentar' });
    expect(menu.closest('[data-viewer-root]')).toBeNull();
  });
});
