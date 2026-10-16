import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeckFolder } from '@slider/shared';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DeleteFolderDialog } from './DeleteFolderDialog';

const api = vi.hoisted(() => ({ mutate: vi.fn(), error: null as Error | null }));

vi.mock('@/lib/api', () => ({
  useDeleteFolder: () => ({ mutate: api.mutate, isPending: false, error: api.error }),
}));

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

const folder = { id: 'f1', name: 'Kunden' } as DeckFolder;

describe('DeleteFolderDialog', () => {
  it('deletes on confirm and reports it', async () => {
    const onDeleted = vi.fn();
    render(
      <DeleteFolderDialog
        workspaceId="w1"
        folder={folder}
        onClose={vi.fn()}
        onDeleted={onDeleted}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ordner löschen', hidden: true }));
    expect(api.mutate).toHaveBeenCalledWith('f1', { onSuccess: onDeleted });
  });

  it('shows a failure inside the dialog, where it is not hidden by the backdrop', () => {
    api.error = new Error('Keine Verbindung zum Server.');
    render(
      <DeleteFolderDialog workspaceId="w1" folder={folder} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Ordner „Kunden“ löschen?', hidden: true });
    expect(within(dialog).getByText('Keine Verbindung zum Server.')).toBeTruthy();
    api.error = null;
  });
});
