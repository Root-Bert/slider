import type { CommentMedia } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { comment } from '../lib/test-fixtures';
import { ThreadMessage } from './ThreadMessage';

const mutate = vi.fn();
vi.mock('@/lib/api', () => ({
  useUpdateComment: () => ({ mutate, isPending: false, isError: false }),
}));
vi.mock('./hooks/useCommentMenu', () => ({
  useCommentMenu: () => ({ actions: [], menus: null, onContextMenu: undefined }),
}));
vi.mock('./CommentContent', () => ({ CommentContent: () => null }));
vi.mock('../state/viewer-state', () => ({
  useViewerDispatch: () => vi.fn(),
  // The card's "Bearbeiten" opened this comment's editor.
  useViewerState: () => ({ editingCommentId: 'edited' }),
}));

const recording: CommentMedia = {
  id: 'm1',
  kind: 'audio',
  mimeType: 'audio/webm',
  sizeBytes: 1000,
  durationMs: 4200,
  peaks: [],
  url: '/api/media/m1',
};

async function clearNote(overrides: Parameters<typeof comment>[0]) {
  render(
    <ThreadMessage
      comment={comment({ id: 'edited', body: 'Hör mal rein.', ...overrides })}
      deckId="d1"
      isRoot
    />,
  );
  await userEvent.clear(screen.getByRole('textbox', { name: 'Kommentar bearbeiten' }));
  return screen.getByRole('button', { name: 'Speichern' });
}

describe('ThreadMessage editing', () => {
  it('saves an empty note on a voice comment: the recording stays the content', async () => {
    const save = await clearNote({ media: recording });
    expect(save).toHaveProperty('disabled', false);
    await userEvent.click(save);
    expect(mutate).toHaveBeenCalledWith({ commentId: 'edited', body: '' }, expect.anything());
  });

  it('saves an empty note on an image comment', async () => {
    const save = await clearNote({
      images: [{ id: 'i1', mimeType: 'image/png', sizeBytes: 500, url: '/api/media/i1' }],
    });
    expect(save).toHaveProperty('disabled', false);
  });

  it('never empties a plain text comment', async () => {
    mutate.mockClear();
    const save = await clearNote({});
    expect(save).toHaveProperty('disabled', true);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(mutate).not.toHaveBeenCalled();
  });
});
