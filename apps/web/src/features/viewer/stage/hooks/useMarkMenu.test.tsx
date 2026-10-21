import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Comment } from '@slider/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../comments/lib/comment-selectors';
import { pinOf, useMarkMenu } from './useMarkMenu';

const update = vi.fn(() => Promise.resolve());
const erase = vi.fn();
const showToast = vi.fn();
vi.mock('@/lib/api', () => ({
  useUpdateComment: () => ({ mutateAsync: update }),
  useEraseDrawing: () => ({ mutate: erase }),
}));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

const pen = {
  tool: 'pen',
  color: 'red',
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
  ],
} as const;
const text = {
  tool: 'text',
  color: 'red',
  x: 0.5,
  y: 0.5,
  w: 0.2,
  h: 0.1,
  text: 'Hi',
  fontSize: 0.04,
} as const;

const comment = (overrides: Partial<Comment> = {}) =>
  ({
    id: 'c1',
    body: 'Bitte prüfen',
    media: null,
    image: null,
    anchor: { type: 'rect', rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, shapeRef: null },
    strokes: [pen],
    ...overrides,
  }) as unknown as Comment;
const thread = (root: Comment): Thread => ({ id: root.id, root, replies: [] }) as unknown as Thread;

function Harness({ target, own = true }: { target: Thread; own?: boolean }) {
  const menu = useMarkMenu({ deckId: 'd1', isOwn: () => own });
  const activate = vi.fn();
  return (
    <>
      <div
        data-testid="mark"
        onContextMenu={(event) => menu.onContextMenu(event, target, activate)}
      />
      {menu.contextMenu}
    </>
  );
}

describe('useMarkMenu', () => {
  beforeEach(() => {
    update.mockClear();
    erase.mockClear();
  });

  it('takes the drawing off a comment, which keeps a pin where its badge was', async () => {
    render(<Harness target={thread(comment())} />);
    fireEvent.contextMenu(screen.getByTestId('mark'));
    expect(screen.getByRole('menuitem', { name: 'Kommentar öffnen' })).toBeTruthy();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zeichnung löschen' }));
    expect(update).toHaveBeenCalledWith({
      commentId: 'c1',
      removeMarks: { pin: { x: 0.1, y: 0.2 } },
    });
    expect(erase).not.toHaveBeenCalled();
  });

  it('deletes a drawing without a comment', async () => {
    render(<Harness target={thread(comment({ body: '' }))} />);
    fireEvent.contextMenu(screen.getByTestId('mark'));
    expect(screen.getByRole('menuitem', { name: 'Kommentar schreiben' })).toBeTruthy();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zeichnung löschen' }));
    expect(erase).toHaveBeenCalledWith('c1', expect.anything());
    expect(update).not.toHaveBeenCalled();
  });

  it('names text as text, and offers no delete on other people’s marks', () => {
    const { unmount } = render(
      <Harness target={thread(comment({ strokes: [text] as unknown as Comment['strokes'] }))} />,
    );
    fireEvent.contextMenu(screen.getByTestId('mark'));
    expect(screen.getByRole('menuitem', { name: 'Text löschen' })).toBeTruthy();
    unmount();
    render(<Harness target={thread(comment())} own={false} />);
    fireEvent.contextMenu(screen.getByTestId('mark'));
    expect(screen.queryByRole('menuitem', { name: 'Zeichnung löschen' })).toBeNull();
  });

  it('only opens the comment on a plain pin or box', () => {
    render(<Harness target={thread(comment({ strokes: [] }))} />);
    fireEvent.contextMenu(screen.getByTestId('mark'));
    expect(screen.getByRole('menuitem', { name: 'Kommentar öffnen' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });
});

describe('pinOf', () => {
  it('keeps a box of its own', () => {
    const own = comment({
      anchor: { type: 'rect', rect: { x: 0, y: 0, w: 0.9, h: 0.9 }, shapeRef: null },
    });
    expect(pinOf(own)).toBeNull();
  });

  it('puts the pin on the text box’s corner', () => {
    const onText = comment({
      anchor: { type: 'rect', rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, shapeRef: null },
      strokes: [text] as unknown as Comment['strokes'],
    });
    expect(pinOf(onText)).toEqual({ x: 0.5, y: 0.5 });
  });
});
