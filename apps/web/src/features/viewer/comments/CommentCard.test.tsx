import type { Author } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { author, comment } from '../lib/test-fixtures';
import { buildThreads } from './lib/comment-selectors';
import { CommentCard } from './CommentCard';

const lena = author('lena', { name: 'Lena Hoffmann', color: 'green' });
const me = author('me', { name: 'Rita', color: 'violet' }) as Author;

vi.mock('@/lib/api', () => ({
  useCreateReply: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateComment: () => ({ mutate: vi.fn(), isError: false }),
}));
vi.mock('./hooks/useCommentMenu', () => ({
  useCommentMenu: () => ({ menus: null, onContextMenu: undefined }),
}));
vi.mock('../live/LiveThreadMarker', () => ({ LiveThreadMarker: () => null }));
vi.mock('./CommentContent', () => ({ CommentContent: () => null }));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({ viewer: { author: me }, mentionable: [lena], participantNames: [] }),
}));
vi.mock('../state/viewer-toast', () => ({ useViewerToast: () => vi.fn() }));
vi.mock('../state/viewer-state', () => ({ useViewerDispatch: () => vi.fn() }));

const [thread] = buildThreads([comment({ author: lena, source: 'pptx' })]);

describe('CommentCard', () => {
  it('suggests people after @ in the reply bar as well', async () => {
    render(<CommentCard thread={thread!} deckId="d1" emphasis="normal" canResolve />);
    const field = screen.getByRole('combobox', { name: 'Antwort an Lena Hoffmann' });
    await userEvent.type(field, '@Le');
    expect(screen.getByRole('option', { name: 'Lena Hoffmann' })).toBeTruthy();
    await userEvent.keyboard('{Enter}');
    expect(field).toHaveProperty('value', '@Lena Hoffmann ');
  });

  it('keeps the author’s full name readable: a tooltip, and the PowerPoint note gives way', () => {
    render(<CommentCard thread={thread!} deckId="d1" emphasis="normal" canResolve />);
    const name = screen.getByText('Lena Hoffmann', { selector: 'span' });
    expect(name.getAttribute('title')).toBe('Lena Hoffmann');
    // "aus PowerPoint" only shows in a wide line; the date stays and gives way before the name.
    const note = screen.getByText(/aus PowerPoint/);
    expect(note.className).toContain('hidden');
    expect(note.closest('time')?.className).toContain('shrink-[4]');
  });
});
