import type { Comment } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangedSinceCommentNote, RemovedInPowerPointNote } from './RevisionNotes';

const update = { mutate: vi.fn() };
const dispatch = vi.fn();
const revealSlide = vi.fn();
const state = { previousView: null as { slideId: string; threadId: string } | null };

vi.mock('@/lib/api', () => ({ useUpdateComment: () => update }));
vi.mock('../state/viewer-state', () => ({
  useViewerState: () => state,
  useViewerDispatch: () => dispatch,
}));
vi.mock('../state/stage-registry', () => ({ useStageRegistry: () => ({ revealSlide }) }));

const comment = (patch: Partial<Comment> = {}) =>
  ({ id: 't1', slideId: 's1', status: 'open', ...patch }) as Comment;

beforeEach(() => {
  update.mutate.mockClear();
  dispatch.mockClear();
  revealSlide.mockClear();
  state.previousView = null;
});

describe('ChangedSinceCommentNote', () => {
  it('switches the slide to the old version and back', async () => {
    const { rerender } = render(
      <ChangedSinceCommentNote comment={comment()} deckId="deck-1" canResolve />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Folie zeigen wie' });
    const neu = screen.getByRole('radio', { name: 'Neu' });
    expect(neu.getAttribute('aria-checked')).toBe('true');
    expect(group.contains(neu)).toBe(true);

    // Picking the current version does nothing.
    await userEvent.click(neu);
    expect(dispatch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: 'Alt' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'previousViewSet',
      view: { slideId: 's1', threadId: 't1' },
    });
    expect(revealSlide).toHaveBeenCalledWith('s1', { align: 'nearest', behavior: 'smooth' });

    state.previousView = { slideId: 's1', threadId: 't1' };
    rerender(<ChangedSinceCommentNote comment={comment()} deckId="deck-1" canResolve />);
    expect(screen.getByRole('radio', { name: 'Alt' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('radio', { name: 'Neu' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'previousViewSet', view: null });
    expect(revealSlide).toHaveBeenCalledOnce();
  });

  it('keeps its clicks from the card behind it', async () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <ChangedSinceCommentNote comment={comment()} deckId="deck-1" canResolve />
      </div>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Alt' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt' }));
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('resolves the thread from the quick action', async () => {
    render(<ChangedSinceCommentNote comment={comment()} deckId="deck-1" canResolve />);
    const resolve = screen.getByRole('button', { name: 'Erledigt' });
    expect(resolve.getAttribute('title')).toBe('Als erledigt markieren');
    await userEvent.click(resolve);
    expect(update.mutate).toHaveBeenCalledWith({ commentId: 't1', status: 'done' });
  });

  it('hides the quick action without rights and the switch without a slide', () => {
    render(
      <ChangedSinceCommentNote
        comment={comment({ slideId: null })}
        deckId="deck-1"
        canResolve={false}
      />,
    );
    expect(screen.getByText('Geändert seit Kommentar')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('RemovedInPowerPointNote', () => {
  it('marks the comment as archived', () => {
    const { container } = render(<RemovedInPowerPointNote />);
    const note = container.querySelector('[data-removed-in-pptx]')!;
    expect(note.textContent).toBe('In PowerPoint entfernt – hier archiviert');
    expect(note.getAttribute('title')).toContain('In Slider bleibt er');
  });
});
