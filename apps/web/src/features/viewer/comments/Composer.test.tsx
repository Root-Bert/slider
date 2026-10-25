import { MAX_COMMENT_BODY_LENGTH, type Author } from '@slider/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImageFile from '../media/lib/image-file';
import type { RecorderState, Recording } from '../media/hooks/useRecorder';
import type { Draft } from '../state/viewer-state';
import { unsavedWork } from '../lib/unsaved-work';
import { ViewerToastContext } from '../state/viewer-toast';
import { Composer } from './Composer';

const me = { id: 'u1', name: 'Rita Roth', color: 'violet', type: 'owner' } as Author;
const createComment = { mutate: vi.fn(), isPending: false, error: null as Error | null };
const recorder = {
  state: { status: 'idle' } as RecorderState,
  stream: null,
  levels: [],
  elapsedMs: 0,
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  reset: vi.fn(),
};
let draft: Draft;
const dispatch = vi.fn();

vi.mock('@/lib/api', () => ({
  useCreateComment: () => createComment,
  useDeleteComment: () => ({ mutate: vi.fn() }),
}));
const createMedia = {
  mutate: vi.fn(),
  cancel: vi.fn(),
  isPending: false,
  progress: 0,
  error: null,
};
vi.mock('../media/hooks/useMediaComment', () => ({
  useCreateMediaComment: () => createMedia,
  useMediaUsage: () => ({ data: undefined }),
}));
// A browser decodes and draws the picture; here it is just handed through.
vi.mock('../media/lib/image-file', async (original) => ({
  ...(await original<typeof ImageFile>()),
  imageToPng: async (file: Blob) => file,
}));
vi.mock('../media/hooks/useRecorder', () => ({ useRecorder: () => recorder }));
vi.mock('./hooks/useComposerPosition', () => ({
  useComposerPosition: () => ({ left: 0, top: 0 }),
}));
vi.mock('../state/viewer-data', () => ({
  useViewerData: () => ({
    deck: { id: 'd1' },
    viewer: { author: me },
    slides: [{ id: 's3', aspectRatio: 16 / 9 }],
    slideIndex: new Map([['s3', 2]]),
    mentionable: [],
    participantNames: [],
  }),
}));
vi.mock('../state/viewer-state', () => ({
  useViewerState: () => ({ draft }),
  useViewerDispatch: () => dispatch,
}));

const recording: Recording = {
  kind: 'audio',
  blob: new Blob(['x']),
  url: 'blob:recording',
  mimeType: 'audio/webm',
  durationMs: 4_000,
  peaks: [0.4],
};

beforeEach(() => {
  dispatch.mockClear();
  recorder.state = { status: 'idle' };
  recorder.reset.mockClear();
  createComment.mutate.mockClear();
  createMedia.mutate.mockClear();
  draft = {
    slideId: 's3',
    anchor: { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
    anchorFromStrokes: false,
    strokes: [],
    undone: [],
    textBox: null,
    commentId: null,
  };
});

describe('Composer, pasted images (BER-174)', () => {
  const screenshot = () => new File(['png'], 'screenshot.png', { type: 'image/png' });
  const paste = (field: HTMLElement, files: File[], types = ['Files']) =>
    fireEvent.paste(field, { clipboardData: { files, types } });

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('takes a screenshot pasted into the text as the comment’s picture, and sends it', async () => {
    render(<Composer />);
    const field = screen.getByRole('combobox', { name: 'Kommentar' });
    paste(field, [screenshot()]);
    expect(await screen.findByAltText('Angehängtes Bild 1')).toBeTruthy();
    // The picture is the comment: no text needed.
    const send = screen.getByRole('button', { name: /Senden/ });
    expect(send).toHaveProperty('disabled', false);
    await userEvent.click(send);
    expect(createComment.mutate).not.toHaveBeenCalled();
    const [upload] = createMedia.mutate.mock.calls[0]!;
    expect(upload.input.body).toBe('');
    expect(upload.recording).toBeNull();
    expect(upload.images).toHaveLength(1);
    expect(await upload.images[0]!()).toBeInstanceOf(Blob);
  });

  it('removes the picture again', async () => {
    render(<Composer />);
    paste(screen.getByRole('combobox', { name: 'Kommentar' }), [screenshot()]);
    await screen.findByAltText('Angehängtes Bild 1');
    await userEvent.click(screen.getByRole('button', { name: 'Bild 1 entfernen' }));
    expect(screen.queryByAltText('Angehängtes Bild 1')).toBeNull();
    expect(screen.getByRole('button', { name: /Senden/ })).toHaveProperty('disabled', true);
  });

  it('leaves pasted text alone – even when the clipboard also carries a picture', () => {
    render(<Composer />);
    paste(
      screen.getByRole('combobox', { name: 'Kommentar' }),
      [screenshot()],
      ['Files', 'text/plain'],
    );
    expect(screen.queryByAltText('Angehängtes Bild 1')).toBeNull();
  });

  it('takes several pasted images, in order, and sends them all', async () => {
    render(<Composer />);
    const field = screen.getByRole('combobox', { name: 'Kommentar' });
    paste(field, [screenshot(), screenshot()]);
    expect(await screen.findByAltText('Angehängtes Bild 2')).toBeTruthy();
    paste(field, [screenshot()]);
    expect(await screen.findByAltText('Angehängtes Bild 3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Senden/ }));
    const [upload] = createMedia.mutate.mock.calls[0]!;
    expect(upload.images).toHaveLength(3);
  });

  it('takes no more than ten images', async () => {
    render(<Composer />);
    paste(
      screen.getByRole('combobox', { name: 'Kommentar' }),
      Array.from({ length: 11 }, screenshot),
    );
    expect(await screen.findByAltText('Angehängtes Bild 10')).toBeTruthy();
    expect(screen.queryByAltText('Angehängtes Bild 11')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Höchstens 10 Bilder');
    // Disabled for assistive tech, but still focusable: focus stays on the paperclip.
    expect(
      screen.getByRole('button', { name: 'Bilder anhängen' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('offers the paperclip with every kind of comment, its images stay when switching', async () => {
    render(<Composer />);
    paste(screen.getByRole('combobox', { name: 'Kommentar' }), [screenshot()]);
    await screen.findByAltText('Angehängtes Bild 1');
    for (const kind of ['Bild', 'Video', 'Text']) {
      await userEvent.click(screen.getByRole('tab', { name: kind }));
      expect(screen.getByRole('button', { name: 'Bilder anhängen' })).toBeTruthy();
      expect(screen.getByAltText('Angehängtes Bild 1')).toBeTruthy();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' }));
    expect(screen.getByAltText('Angehängtes Bild 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Oder ein Bild hochladen/ })).toBeNull();
  });
});

describe('Composer', () => {
  it('is named after what it is, not who writes', () => {
    render(<Composer />);
    expect(screen.getByRole('dialog', { name: 'Neuer Kommentar | Folie 3' })).toBeTruthy();
  });

  it('keeps what is written when the slide leaves the deck, but no longer sends it', async () => {
    const view = render(<Composer />);
    const field = screen.getByRole('combobox', { name: 'Kommentar' });
    await userEvent.type(field, 'Logo zu klein');
    // A synced revision deleted (or hid) the slide.
    draft = { ...draft, slideGone: true };
    view.rerender(<Composer />);
    expect(screen.getByRole('combobox', { name: 'Kommentar' })).toHaveProperty(
      'value',
      'Logo zu klein',
    );
    expect(screen.getByRole('alert').textContent).toContain('nicht mehr zu sehen');
    expect(screen.getByRole('button', { name: /Senden/ })).toHaveProperty('disabled', true);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Kommentar' }),
      '{Meta>}{Enter}{/Meta}',
    );
    expect(createComment.mutate).not.toHaveBeenCalled();
  });

  it('stops the comment at the length the API takes', () => {
    render(<Composer />);
    expect(screen.getByRole('combobox', { name: 'Kommentar' }).getAttribute('maxlength')).toBe(
      String(MAX_COMMENT_BODY_LENGTH),
    );
  });

  it('Tab from the comment field reaches Abbrechen, Bilder anhängen, the mic and Senden', async () => {
    render(<Composer />);
    const field = screen.getByRole('combobox', { name: 'Kommentar' });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, 'Zu klein');
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bilder anhängen' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' }),
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Senden/ }));
    // Still the text kind: Tab did not switch it.
    expect(screen.getByRole('tab', { name: /Text/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps a finished recording when Tab moves on to Senden', async () => {
    recorder.state = { status: 'recorded', recording };
    render(<Composer />);
    await userEvent.click(screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' }));
    expect(screen.getByRole('group', { name: /Sprachkommentar/ })).toBeTruthy();
    const send = screen.getByRole('button', { name: /Senden/ });
    for (let i = 0; i < 10 && document.activeElement !== send; i += 1) await userEvent.tab();
    expect(document.activeElement).toBe(send);
    expect(send).toHaveProperty('disabled', false);
    expect(screen.getByRole('group', { name: /Sprachkommentar/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Text/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('Tab from outside moves the focus into it', async () => {
    render(<Composer />);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Text/ }));
    act(() => (document.activeElement as HTMLElement).blur());
    await userEvent.tab({ shift: true });
    // The last control: Senden is still off without text.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' }),
    );
  });

  it('typing from outside writes into it, "@" (⌥L) too', () => {
    render(<Composer />);
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: '@', altKey: true });
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Kommentar' }));
  });

  it('holds the draft while it has text: no click replaces it, leaving asks first', async () => {
    const view = render(<Composer />);
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'draftHeld', held: true });
    expect(unsavedWork.has()).toBe(false);
    await userEvent.type(screen.getByRole('combobox', { name: 'Kommentar' }), 'Logo');
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'draftHeld', held: true });
    expect(unsavedWork.has()).toBe(true);
    view.unmount();
    expect(unsavedWork.has()).toBe(false);
  });

  it('records voice from the text tab, the mic again drops it', async () => {
    recorder.state = { status: 'recorded', recording };
    render(<Composer />);
    const mic = screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' });
    await userEvent.click(mic);
    expect(screen.getByRole('group', { name: /Sprachkommentar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Senden/ })).toHaveProperty('disabled', false);
    await userEvent.click(screen.getByRole('button', { name: 'Sprachaufnahme verwerfen' }));
    expect(screen.queryByRole('group', { name: /Sprachkommentar/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Senden/ })).toHaveProperty('disabled', true);
  });

  it('holds a finished recording even without text', async () => {
    recorder.state = { status: 'recorded', recording };
    render(<Composer />);
    await userEvent.click(screen.getByRole('button', { name: 'Sprachkommentar aufnehmen' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'draftHeld', held: true });
  });

  it('says why a click elsewhere was ignored', () => {
    const showToast = vi.fn();
    const view = render(
      <ViewerToastContext value={showToast}>
        <Composer />
      </ViewerToastContext>,
    );
    expect(showToast).not.toHaveBeenCalled();
    draft = { ...draft, held: true, nudge: 1 };
    view.rerender(
      <ViewerToastContext value={showToast}>
        <Composer />
      </ViewerToastContext>,
    );
    expect(showToast).toHaveBeenCalledWith(
      'Dein Kommentar ist noch offen – sende oder verwirf ihn zuerst.',
    );
  });
});
