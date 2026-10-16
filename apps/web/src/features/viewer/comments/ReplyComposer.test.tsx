import type { Author, Comment } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplyComposer } from './ReplyComposer';

const me = { id: 'u1', name: 'Rita', color: 'violet' } as Author;
const anna = { id: 'u2', name: 'Anna', color: 'green' } as Author;
const createReply = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
};
const showToast = vi.fn();

vi.mock('@/lib/api', () => ({ useCreateReply: () => createReply }));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({
    viewer: { author: me },
    mentionable: [anna],
    participantNames: [],
  }),
}));
vi.mock('../state/viewer-toast', () => ({ useViewerToast: () => showToast }));
vi.mock('../media/RecordReplyDialog', () => ({
  RecordReplyDialog: ({ kind }: { kind: string }) => <div role="dialog" aria-label={kind} />,
}));
vi.mock('../media/SketchReplyDialog', () => ({
  SketchReplyDialog: () => <div role="dialog" aria-label="image" />,
}));

const root = { id: 'r1', slideId: 's1', author: anna } as Comment;

beforeEach(() => {
  createReply.mutate.mockClear();
  createReply.isError = false;
  createReply.error = null;
  showToast.mockClear();
});

describe('ReplyComposer', () => {
  it('sends with Enter and clears the field', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('textbox', { name: 'Antwort an Anna' });
    const send = screen.getByRole('button', { name: 'Antwort senden' });
    expect(send).toHaveProperty('disabled', true);
    await userEvent.type(field, 'Passt so');
    expect(send).toHaveProperty('disabled', false);
    await userEvent.type(field, '{Enter}');
    expect(createReply.mutate).toHaveBeenCalledWith(
      {
        input: {
          slideId: 's1',
          parentId: 'r1',
          body: 'Passt so',
          anchor: { type: 'slide' },
          strokes: [],
        },
        root,
      },
      expect.anything(),
    );
    expect((field as HTMLTextAreaElement).value).toBe('');
  });

  it('offers voice, video and image replies beside the field', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Mit Video antworten' }));
    expect(screen.getByRole('dialog', { name: 'video' })).toBeTruthy();
  });

  it('suggests people after @ and inserts the picked name', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('textbox', { name: 'Antwort an Anna' }) as HTMLTextAreaElement;
    await userEvent.type(field, 'Danke @An');
    const option = screen.getByRole('option', { name: 'Anna' });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(field.getAttribute('aria-activedescendant')).toBe(option.id);
    await userEvent.type(field, '{Enter}');
    expect(field.value).toBe('Danke @Anna ');
    expect(createReply.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('inline: Esc and ✕ cancel, a sent reply calls onSent', async () => {
    const onCancel = vi.fn();
    const onSent = vi.fn();
    createReply.mutate.mockImplementation((_input, options: { onSuccess: () => void }) =>
      options.onSuccess(),
    );
    render(
      <ReplyComposer
        root={root}
        deckId="deck-1"
        variant="inline"
        autoFocus
        onCancel={onCancel}
        onSent={onSent}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Antwort an Anna' });
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('Rita')).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Antwort verwerfen' }));
    expect(onCancel).toHaveBeenCalledTimes(2);

    await userEvent.type(field, 'Ok');
    await userEvent.click(screen.getByRole('button', { name: 'Antwort senden' }));
    expect(onSent).toHaveBeenCalledOnce();
    createReply.mutate.mockReset();
  });

  it('shows a failed reply inline', () => {
    createReply.isError = true;
    createReply.error = new Error('Keine Verbindung');
    render(<ReplyComposer root={root} deckId="deck-1" />);
    expect(screen.getByRole('alert').textContent).toBe('Keine Verbindung');
  });
});
