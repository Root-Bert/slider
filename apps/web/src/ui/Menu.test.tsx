import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, Menu, type MenuAction } from '@/ui';
import { anchoredMenuPosition } from './menu-position';

const makeActions = () => {
  const rename = vi.fn();
  const move = vi.fn();
  const remove = vi.fn();
  const actions: MenuAction[] = [
    { label: 'Umbenennen', icon: 'edit', onSelect: rename },
    {
      label: 'Verschieben',
      icon: 'folder',
      onSelect: move,
      disabled: true,
      title: 'Nicht erlaubt',
    },
    { label: 'Löschen', icon: 'delete', onSelect: remove, tone: 'danger' },
  ];
  return { actions, rename, move, remove };
};

describe('Menu', () => {
  it('is a menu button: closed, then expanded with a labelled menu', async () => {
    const { actions } = makeActions();
    render(<Menu label="Aktionen für „Q4“" actions={actions} />);
    const trigger = screen.getByRole('button', { name: 'Aktionen für „Q4“' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-pressed')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Aktionen für „Q4“' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(menu.className).toContain('z-(--z-popover)');
    // A pointer-opened menu focuses itself, not the first item.
    expect(document.activeElement).toBe(menu);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('opens with ↓, focuses the first item and moves over enabled items only', async () => {
    const { actions } = makeActions();
    render(<Menu label="Aktionen" actions={actions} />);
    screen.getByRole('button', { name: 'Aktionen' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    const [rename, move, remove] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(rename);

    // The disabled item stays in the list (with its reason) but the arrows skip it.
    expect(move!.getAttribute('aria-disabled')).toBe('true');
    expect(move!.getAttribute('title')).toBe('Nicht erlaubt');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(remove);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rename);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(remove);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(rename);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(remove);
  });

  it('selects an item: closes, returns focus to the trigger, runs the action', async () => {
    const { actions, remove } = makeActions();
    render(<Menu label="Aktionen" actions={actions} />);
    const trigger = screen.getByRole('button', { name: 'Aktionen' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ignores clicks on disabled items', async () => {
    const { actions, move } = makeActions();
    render(<Menu label="Aktionen" actions={actions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Verschieben' }));
    expect(move).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape (focus back on the trigger), Tab and an outside press', async () => {
    const { actions } = makeActions();
    render(
      <>
        <Menu label="Aktionen" actions={actions} />
        <button type="button">Draußen</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Aktionen' });

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await userEvent.click(trigger);
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Draußen' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens with Enter and focuses the first item', async () => {
    const { actions } = makeActions();
    render(<Menu label="Aktionen" actions={actions} />);
    screen.getByRole('button', { name: 'Aktionen' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Umbenennen' }));
  });

  it('sizes the trigger via triggerSize (default sm)', () => {
    const { actions } = makeActions();
    render(
      <>
        <Menu label="Standard" actions={actions} />
        <Menu label="Kompakt" actions={actions} triggerSize="compact" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Standard' }).className).toContain('size-8');
    expect(screen.getByRole('button', { name: 'Kompakt' }).className).toContain('size-7');
  });

  it('moves the focus along with the pointer, but not onto disabled items', async () => {
    const { actions } = makeActions();
    render(<Menu label="Aktionen" actions={actions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    const remove = screen.getByRole('menuitem', { name: 'Löschen' });
    fireEvent.mouseEnter(remove);
    expect(document.activeElement).toBe(remove);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Verschieben' }));
    expect(document.activeElement).toBe(remove);
  });
});

describe('Menu positioning', () => {
  const wrapperOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

  it('anchors its panel to a relative wrapper by default', () => {
    const { container } = render(<Menu label="Aktionen" actions={makeActions().actions} />);
    expect(wrapperOf(container).classList.contains('relative')).toBe(true);
  });

  it('keeps a position the caller sets – `relative` would override `absolute` in the CSS', () => {
    const { container } = render(
      <Menu label="Aktionen" actions={makeActions().actions} className="absolute top-2 right-2" />,
    );
    const wrapper = wrapperOf(container);
    expect(wrapper.classList.contains('absolute')).toBe(true);
    expect(wrapper.classList.contains('relative')).toBe(false);
  });
});

describe('Menu inside a glass card', () => {
  it('portals the open panel into <body>, out of the card’s stacking context', async () => {
    render(
      <ol>
        <li className="glass" data-testid="card">
          <Menu label="Aktionen" actions={makeActions().actions} />
        </li>
        <li className="glass">Nächste Antwort</li>
      </ol>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen' }));
    const menu = screen.getByRole('menu', { name: 'Aktionen' });
    expect(screen.getByTestId('card').contains(menu)).toBe(false);
    expect(menu.parentElement?.parentElement).toBe(document.body);
    expect(menu.parentElement?.className).toContain('fixed');
    expect(menu.parentElement?.className).toContain('z-(--z-popover)');
    // Still inside for the outside-press check: an item click runs its action.
    await userEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Tab from a portalled item continues after the trigger', async () => {
    render(
      <>
        <Menu label="Aktionen" actions={makeActions().actions} />
        <button type="button">Danach</button>
      </>,
    );
    screen.getByRole('button', { name: 'Aktionen' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Danach' }));
  });
});

describe('anchoredMenuPosition', () => {
  const viewport = { width: 400, height: 800 };
  const menu = { width: 192, height: 80 };

  it('opens below the trigger, right edges aligned', () => {
    const trigger = { top: 100, bottom: 132, right: 380 };
    expect(anchoredMenuPosition(trigger, menu, viewport)).toEqual({ left: 188, top: 136 });
  });

  it('flips above the trigger near the bottom edge', () => {
    const trigger = { top: 740, bottom: 772, right: 380 };
    expect(anchoredMenuPosition(trigger, menu, viewport)).toEqual({ left: 188, top: 656 });
  });

  it('stays inside the viewport at the left edge', () => {
    const trigger = { top: 100, bottom: 132, right: 40 };
    expect(anchoredMenuPosition(trigger, menu, viewport).left).toBe(8);
  });
});

describe('ContextMenu', () => {
  it('renders the menu into the body at the pointer and closes on Escape', async () => {
    const { actions } = makeActions();
    const onClose = vi.fn();
    render(
      <ContextMenu label="Aktionen" actions={actions} at={{ x: 20, y: 30 }} onClose={onClose} />,
    );
    const menu = screen.getByRole('menu', { name: 'Aktionen' });
    expect(menu.parentElement?.parentElement).toBe(document.body);
    expect(menu.parentElement?.className).toContain('z-(--z-popover)');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
