import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeckFolder } from '@slider/shared';
import { FolderTiles } from './FolderTiles';

const folder = { id: 'f1', name: 'Kunden' } as DeckFolder;

function setup(withManage = true) {
  const manage = { onRename: vi.fn(), onDelete: vi.fn(), onDropDecks: vi.fn() };
  const onOpen = vi.fn();
  render(
    <FolderTiles
      folders={[folder]}
      counts={new Map([['f1', 2]])}
      onOpen={onOpen}
      manage={withManage ? manage : undefined}
    />,
  );
  return { manage, onOpen };
}

describe('FolderTiles', () => {
  it('renames and deletes from the ⋯ menu, without a right click (touch, keyboard)', async () => {
    const { manage } = setup();
    const trigger = screen.getByRole('button', { name: 'Aktionen für Ordner „Kunden“' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Umbenennen' }));
    expect(manage.onRename).toHaveBeenCalledWith(folder);

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ordner löschen' }));
    expect(manage.onDelete).toHaveBeenCalledWith(folder);
  });

  it('has no ⋯ menu for people who cannot manage folders', () => {
    const { onOpen } = setup(false);
    expect(screen.queryByRole('button', { name: /Aktionen für Ordner/ })).toBeNull();
    screen.getByRole('button', { name: /Kunden/ }).click();
    expect(onOpen).toHaveBeenCalledWith('f1');
  });
});
