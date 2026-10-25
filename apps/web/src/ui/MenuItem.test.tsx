import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuDivider, MenuHeading, MenuItem } from '@/ui';

const classesOf = (element: Element) => element.className.split(/\s+/);

describe('MenuItem', () => {
  it('is a type=button button with the shared row look by default', async () => {
    const onClick = vi.fn();
    render(<MenuItem onClick={onClick}>Umbenennen</MenuItem>);
    const item = screen.getByRole('button', { name: 'Umbenennen' });
    expect(item.getAttribute('type')).toBe('button');
    expect(classesOf(item)).toEqual(
      expect.arrayContaining(['min-h-9', 'text-body', 'hover:bg-hover', 'focus-visible:bg-hover']),
    );
    // Default inset 6 → control-sm radius.
    expect(classesOf(item)).toContain('rounded-control-sm');
    await userEvent.click(item);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marks keyboard focus with a 2px inset mention ring, not just the hover tint', () => {
    render(<MenuItem>Umbenennen</MenuItem>);
    expect(classesOf(screen.getByRole('button', { name: 'Umbenennen' }))).toEqual(
      expect.arrayContaining([
        'focus-visible:ring-2',
        'focus-visible:ring-inset',
        'focus-visible:ring-mention',
      ]),
    );
  });

  it('maps inset, size, tone and selected to tokens', () => {
    render(
      <>
        <MenuItem inset={4} size="md" tone="danger" icon="delete">
          Löschen
        </MenuItem>
        <MenuItem selected>Acme</MenuItem>
      </>,
    );
    const danger = screen.getByRole('button', { name: 'Löschen' });
    expect(classesOf(danger)).toEqual(
      expect.arrayContaining(['rounded-control', 'text-sm', 'gap-3', 'px-3', 'text-danger']),
    );
    // A danger icon inherits the row colour instead of the subtle grey.
    expect(danger.querySelector('svg')?.getAttribute('class')).not.toContain('text-fg-subtle');

    const selected = screen.getByRole('button', { name: 'Acme' });
    expect(selected.getAttribute('aria-current')).toBe('true');
    expect(classesOf(selected)).toContain('bg-surface-2');
  });

  it('renders an icon name as a subtle 18px icon and nodes as they are', () => {
    render(
      <>
        <MenuItem icon="folder">Ordner</MenuItem>
        <MenuItem icon={<span data-testid="mark" />}>Microsoft</MenuItem>
      </>,
    );
    const icon = screen.getByRole('button', { name: 'Ordner' }).querySelector('svg')!;
    expect(icon.getAttribute('width')).toBe('18');
    expect(icon.getAttribute('class')).toContain('text-fg-subtle');
    expect(screen.getByTestId('mark')).toBeTruthy();
  });

  it('disables natively, dims, and swallows clicks', async () => {
    const onClick = vi.fn();
    render(
      <MenuItem disabled onClick={onClick}>
        Verschieben
      </MenuItem>,
    );
    const item = screen.getByRole('button', { name: 'Verschieben' });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(classesOf(item)).toContain('opacity-40');
    expect(classesOf(item)).not.toContain('hover:bg-hover');
    await userEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can stay focusable and undimmed while disabled', async () => {
    const onClick = vi.fn();
    render(
      <>
        <MenuItem disabled focusableWhenDisabled title="Nur Admins" onClick={onClick}>
          Entfernen
        </MenuItem>
        <MenuItem disabled dimDisabled={false}>
          Aktueller Ort
        </MenuItem>
      </>,
    );
    const focusable = screen.getByRole('button', { name: 'Entfernen' });
    expect((focusable as HTMLButtonElement).disabled).toBe(false);
    expect(focusable.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(focusable);
    expect(onClick).not.toHaveBeenCalled();
    expect(classesOf(screen.getByRole('button', { name: 'Aktueller Ort' }))).not.toContain(
      'opacity-40',
    );
  });

  it('renders as a link or a static row', () => {
    render(
      <>
        <MenuItem as="a" href="/api/auth/microsoft" trailing={<span data-testid="arrow" />}>
          Microsoft verbinden
        </MenuItem>
        <MenuItem as="div" data-testid="static">
          Microsoft verbunden
        </MenuItem>
      </>,
    );
    const link = screen.getByRole('link', { name: 'Microsoft verbinden' });
    expect(link.getAttribute('href')).toBe('/api/auth/microsoft');
    expect(link.hasAttribute('type')).toBe(false);
    expect(screen.getByTestId('arrow')).toBeTruthy();

    const row = screen.getByTestId('static');
    expect(row.tagName).toBe('DIV');
    expect(classesOf(row)).not.toContain('hover:bg-hover');
    expect(row.hasAttribute('aria-disabled')).toBe(false);
  });

  it('forwards refs and extra props (role=menuitem)', () => {
    let element: HTMLButtonElement | null = null;
    render(
      <MenuItem
        role="menuitem"
        ref={(node: HTMLButtonElement | null) => {
          element = node;
        }}
      >
        Kopieren
      </MenuItem>,
    );
    expect(element).toBe(screen.getByRole('menuitem', { name: 'Kopieren' }));
  });
});

describe('MenuDivider and MenuHeading', () => {
  it('render a hairline separator and an uppercase caption', () => {
    render(
      <>
        <MenuHeading id="orgs">Workspaces</MenuHeading>
        <MenuDivider />
      </>,
    );
    const separator = screen.getByRole('separator');
    expect(classesOf(separator)).toEqual(expect.arrayContaining(['bg-hairline', 'mx-2', 'my-1']));
    const heading = screen.getByText('Workspaces');
    expect(heading.id).toBe('orgs');
    expect(classesOf(heading)).toEqual(expect.arrayContaining(['text-caption', 'uppercase']));
  });
});
