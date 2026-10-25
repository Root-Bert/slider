import { MAX_COMMENT_BODY_LENGTH, type Author, type Comment } from '@slider/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageFile from '../media/lib/image-file';
import { replyDrafts } from './lib/reply-drafts';
import { MediaReplyDialog } from './MediaTabs';
import { ReplyComposer } from './ReplyComposer';

const me = { id: 'u1', name: 'Rita', color: 'violet' } as Author;
const anna = { id: 'u2', name: 'Anna', color: 'green' } as Author;
const createReply = {
  mutateAsync: vi.fn(async (_variables: unknown): Promise<unknown> => ({})),
  isPending: false,
  isError: false,
  error: null as Error | null,
};
const showToast = vi.fn();

const createPicture = {
  mutateAsync: vi.fn(async (_variables: unknown): Promise<unknown> => ({})),
  cancel: vi.fn(),
  isPending: false,
  progress: 0,
  error: null as Error | null,
};

vi.mock('@/lib/api', () => ({ useCreateReply: () => createReply }));
vi.mock('../media/hooks/useMediaComment', () => ({ useCreateMediaComment: () => createPicture }));
// A browser decodes and draws the picture; here it is just handed through.
vi.mock('../media/lib/image-file', async (original) => ({
  ...(await original<typeof ImageFile>()),
  imageToPng: async (file: Blob) => file,
}));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({
    deck: { id: 'deck-1' },
    viewer: { author: me },
    mentionable: [anna],
    participantNames: [],
    threadById: new Map([['r1', { id: 'r1', root }]]),
  }),
}));
vi.mock('../state/viewer-toast', () => ({ useViewerToast: () => showToast }));
const dispatch = vi.fn();
let mediaReply: { threadId: string; kind: string } | null = null;
vi.mock('../state/viewer-state', () => ({
  useViewerDispatch: () => dispatch,
  useViewerState: () => ({ mediaReply }),
}));
vi.mock('../media/RecordReplyDialog', () => ({
  RecordReplyDialog: ({ kind }: { kind: string }) => <div role="dialog" aria-label={kind} />,
}));
vi.mock('../media/SketchReplyDialog', () => ({
  SketchReplyDialog: () => <div role="dialog" aria-label="image" />,
}));

const root = { id: 'r1', slideId: 's1', author: anna } as Comment;

beforeEach(() => {
  createReply.mutateAsync.mockReset();
  createPicture.mutateAsync.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  createReply.mutateAsync.mockResolvedValue({});
  replyDrafts.clear();
  mediaReply = null;
  createReply.isError = false;
  createReply.error = null;
  showToast.mockClear();
  dispatch.mockClear();
});

describe('ReplyComposer', () => {
  it('sends with Enter and clears the field', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('combobox', { name: 'Antwort an Anna' });
    const send = screen.getByRole('button', { name: 'Antwort senden' });
    expect(send).toHaveProperty('disabled', true);
    await userEvent.type(field, 'Passt so');
    expect(send).toHaveProperty('disabled', false);
    await userEvent.type(field, '{Enter}');
    expect(createReply.mutateAsync).toHaveBeenCalledWith({
      input: {
        slideId: 's1',
        parentId: 'r1',
        body: 'Passt so',
        anchor: { type: 'slide' },
        strokes: [],
      },
      root,
    });
    expect((field as HTMLTextAreaElement).value).toBe('');
  });

  it('stops the reply at the length the API takes', () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('combobox', { name: 'Antwort an Anna' });
    expect(field.getAttribute('maxlength')).toBe(String(MAX_COMMENT_BODY_LENGTH));
  });

  it('offers voice, video and image replies beside the field', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Mit Video antworten' }));
    // The viewer holds the dialog, so it outlives the field (card scrolled away, turned compact).
    expect(dispatch).toHaveBeenCalledWith({
      type: 'mediaReplyOpened',
      reply: { threadId: 'r1', kind: 'video' },
    });
  });

  it('shows the open reply dialog with no field around, keeping its thread listed', () => {
    mediaReply = { threadId: 'r1', kind: 'video' };
    render(<MediaReplyDialog />);
    expect(screen.getByRole('dialog', { name: 'video' })).toBeTruthy();
    // While the dialog is open, the thread stays listed even if someone else resolves it.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'composingChanged',
      threadId: 'r1',
      composing: true,
    });
  });

  it('keeps the unsent text when the field unmounts and comes back', async () => {
    const first = render(<ReplyComposer root={root} deckId="deck-1" />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Antwort an Anna' }), 'Halbfertig');
    // The card's column was windowed out, or the panel showed another thread.
    first.unmount();
    render(<ReplyComposer root={root} deckId="deck-1" />);
    expect(screen.getByRole('combobox', { name: 'Antwort an Anna' })).toHaveProperty(
      'value',
      'Halbfertig',
    );
  });

  it('brings a failed reply back and says so, also once the field is gone', async () => {
    let fail: (error: Error) => void = () => {};
    createReply.mutateAsync.mockImplementation(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const view = render(<ReplyComposer root={root} deckId="deck-1" />);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Antwort an Anna' }),
      'Passt so{Enter}',
    );
    expect(screen.getByRole('combobox', { name: 'Antwort an Anna' })).toHaveProperty('value', '');
    view.unmount();
    await act(async () => fail(new Error('Keine Verbindung')));
    expect(showToast).toHaveBeenCalledWith('Keine Verbindung', 'danger');
    render(<ReplyComposer root={root} deckId="deck-1" />);
    expect(screen.getByRole('combobox', { name: 'Antwort an Anna' })).toHaveProperty(
      'value',
      'Passt so',
    );
  });

  it('suggests people after @ and inserts the picked name', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('combobox', { name: 'Antwort an Anna' }) as HTMLTextAreaElement;
    await userEvent.type(field, 'Danke @An');
    const option = screen.getByRole('option', { name: 'Anna' });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(field.getAttribute('aria-activedescendant')).toBe(option.id);
    // A combobox, so screen readers follow the active option.
    expect(field.getAttribute('aria-expanded')).toBe('true');
    await userEvent.type(field, '{Enter}');
    expect(field.value).toBe('Danke @Anna ');
    expect(createReply.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('inline: Esc and ✕ cancel, a sent reply calls onSent', async () => {
    const onCancel = vi.fn();
    const onSent = vi.fn();
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
    const field = screen.getByRole('combobox', { name: 'Antwort an Anna' });
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('Rita')).toBeTruthy();

    await userEvent.type(field, 'Doch nicht');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    // Discarded: it doesn't come back with the next reply field of the thread.
    expect(replyDrafts.get('r1')).toBe('');
    await userEvent.type(field, 'Auch nicht');
    await userEvent.click(screen.getByRole('button', { name: 'Antwort verwerfen' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(replyDrafts.get('r1')).toBe('');

    await userEvent.type(field, 'Ok');
    await userEvent.click(screen.getByRole('button', { name: 'Antwort senden' }));
    await vi.waitFor(() => expect(onSent).toHaveBeenCalledOnce());
  });

  it('shows a failed reply inline', () => {
    createReply.isError = true;
    createReply.error = new Error('Keine Verbindung');
    render(<ReplyComposer root={root} deckId="deck-1" />);
    expect(screen.getByRole('alert').textContent).toBe('Keine Verbindung');
  });

  it('sends a screenshot pasted into the field as a reply with a picture (BER-174)', async () => {
    render(<ReplyComposer root={root} deckId="deck-1" />);
    const field = screen.getByRole('combobox', { name: 'Antwort an Anna' });
    fireEvent.paste(field, {
      clipboardData: {
        files: [new File(['png'], 'screenshot.png', { type: 'image/png' })],
        types: ['Files'],
      },
    });
    expect(await screen.findByAltText('Angehängtes Bild 1')).toBeTruthy();
    // The picture is the reply: no text needed.
    await userEvent.click(screen.getByRole('button', { name: 'Antwort senden' }));
    expect(createReply.mutateAsync).not.toHaveBeenCalled();
    const [upload] = createPicture.mutateAsync.mock.calls[0] as [
      { input: { parentId: string; body: string }; images: (() => Promise<Blob>)[] },
    ];
    expect(upload.input).toMatchObject({ parentId: 'r1', body: '' });
    expect(upload.images).toHaveLength(1);
    expect(await upload.images[0]!()).toBeInstanceOf(Blob);
    // Sent: the picture is gone from the field.
    await vi.waitFor(() => expect(screen.queryByAltText('Angehängtes Bild 1')).toBeNull());
  });
});
