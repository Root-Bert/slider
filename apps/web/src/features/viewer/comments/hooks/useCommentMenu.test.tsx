import type { Author, Comment } from '@slider/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentMenu } from './useCommentMenu';

const me = { id: 'u1', name: 'Rita', color: 'violet' } as Author;
const update = { mutateAsync: vi.fn() };
const showToast = vi.fn();
const remove = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
  variables: undefined as { keepDrawing: boolean } | undefined,
};
const data = { viewer: { author: me }, canComment: true, canManage: false };

vi.mock('@/lib/api', () => ({
  useUpdateComment: () => update,
  useDeleteComment: () => remove,
}));
vi.mock('@/lib/api/comment-cache', () => ({ isPendingComment: () => false }));
vi.mock('../../state/viewer-data', () => ({ useViewerData: () => data }));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

beforeAll(() => {
  // happy-dom may lack the modal API.
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal)
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  if (!proto.close)
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
});

beforeEach(() => {
  update.mutateAsync.mockReset().mockResolvedValue({});
  showToast.mockClear();
  remove.mutate.mockReset();
  remove.isError = false;
  remove.error = null;
  data.canManage = false;
});

const comment = (patch: Partial<Comment> = {}) =>
  ({
    id: 'c1',
    status: 'open',
    source: 'app',
    author: me,
    strokes: [],
    ...patch,
  }) as Comment;

/** Lists the actions as plain buttons next to the hook's dialogs. */
function Harness(props: { comment: Comment; isRoot: boolean; onDeleted?: () => void }) {
  const menu = useCommentMenu({ deckId: 'deck-1', onEdit: vi.fn(), ...props });
  return (
    <>
      <ul aria-label="Aktionen">
        {menu.actions.map((action) => (
          <li key={action.label}>
            <button type="button" onClick={action.onSelect}>
              {action.label}
            </button>
          </li>
        ))}
      </ul>
      {menu.menus}
    </>
  );
}

const actionLabels = () =>
  within(screen.getByRole('list', { name: 'Aktionen' }))
    .queryAllByRole('button')
    .map((button) => button.textContent);
const select = (label: string) =>
  userEvent.click(
    within(screen.getByRole('list', { name: 'Aktionen' })).getByRole('button', { name: label }),
  );

describe('useCommentMenu', () => {
  it('offers resolve, edit and delete on an own root', async () => {
    render(<Harness comment={comment()} isRoot />);
    expect(actionLabels()).toEqual(['Erledigt', 'Bearbeiten', 'Löschen']);
    await select('Erledigt');
    expect(update.mutateAsync).toHaveBeenCalledWith({ commentId: 'c1', status: 'done' });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says why a status toggle flipped back', async () => {
    update.mutateAsync.mockRejectedValue(new Error('Keine Berechtigung'));
    render(<Harness comment={comment({ status: 'done' })} isRoot />);
    await select('Wieder öffnen');
    expect(update.mutateAsync).toHaveBeenCalledWith({ commentId: 'c1', status: 'open' });
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Keine Berechtigung', 'danger'));
  });

  it('gives others’ replies no actions unless the viewer manages the deck', () => {
    const other = { id: 'u2', name: 'Anna', color: 'green' } as Author;
    const { rerender } = render(<Harness comment={comment({ author: other })} isRoot={false} />);
    expect(actionLabels()).toEqual([]);
    data.canManage = true;
    rerender(<Harness comment={comment({ author: other })} isRoot={false} />);
    expect(actionLabels()).toEqual(['Löschen']);
  });

  it('confirms the delete and reports when the comment is gone', async () => {
    const onDeleted = vi.fn();
    remove.mutate.mockImplementation((_input, options: { onSuccess: () => void }) =>
      options.onSuccess(),
    );
    render(<Harness comment={comment()} isRoot={false} onDeleted={onDeleted} />);
    await select('Löschen');
    const dialog = screen.getByRole('dialog', { name: 'Kommentar löschen?', hidden: true });
    expect(dialog.textContent).toContain('Das lässt sich nicht rückgängig machen.');
    expect(screen.queryByRole('button', { name: 'Nur Kommentar löschen', hidden: true })).toBe(
      null,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Löschen', hidden: true }));
    expect(remove.mutate).toHaveBeenCalledWith(
      { commentId: 'c1', keepDrawing: false },
      expect.anything(),
    );
    expect(onDeleted).toHaveBeenCalled();
  });

  it('can keep the drawing of a root and shows a failed delete', async () => {
    remove.isError = true;
    remove.error = new Error('Keine Verbindung');
    render(<Harness comment={comment({ strokes: [{}] as Comment['strokes'] })} isRoot />);
    await select('Löschen');
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('Keine Verbindung');
    await userEvent.click(
      screen.getByRole('button', { name: 'Nur Kommentar löschen', hidden: true }),
    );
    expect(remove.mutate).toHaveBeenCalledWith(
      { commentId: 'c1', keepDrawing: true },
      expect.anything(),
    );
  });
});
