import { MAX_COMMENT_BODY_LENGTH, type Author } from '@slider/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../media/hooks/useMediaComment', () => ({
  useCreateMediaComment: () => ({
    mutate: vi.fn(),
    cancel: vi.fn(),
    isPending: false,
    progress: 0,
    error: null,
  }),
  useMediaUsage: () => ({ data: undefined }),
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

describe('Composer', () => {
  it('is named after what it is, not who writes', () => {
    render(<Composer />);
    expect(screen.getByRole('dialog', { name: 'Neuer Kommentar · Folie 3' })).toBeTruthy();
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

  it('Tab from the comment field reaches Abbrechen and Senden', async () => {
    render(<Composer />);
    const field = screen.getByRole('combobox', { name: 'Kommentar' });
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, 'Zu klein');
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Senden/ }));
    // Still the text kind: Tab did not switch it.
    expect(screen.getByRole('tab', { name: /Text/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps a finished recording when Tab moves on to Senden', async () => {
    recorder.state = { status: 'recorded', recording };
    render(<Composer />);
    await userEvent.click(screen.getByRole('tab', { name: /Audio/ }));
    expect(screen.getByRole('group', { name: /Sprachkommentar/ })).toBeTruthy();
    const send = screen.getByRole('button', { name: /Senden/ });
    for (let i = 0; i < 10 && document.activeElement !== send; i += 1) await userEvent.tab();
    expect(document.activeElement).toBe(send);
    expect(send).toHaveProperty('disabled', false);
    expect(screen.getByRole('group', { name: /Sprachkommentar/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Audio/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('Tab from outside moves the focus into it', async () => {
    render(<Composer />);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Text/ }));
    act(() => (document.activeElement as HTMLElement).blur());
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
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

  it('holds a finished recording even without text', async () => {
    recorder.state = { status: 'recorded', recording };
    render(<Composer />);
    await userEvent.click(screen.getByRole('tab', { name: /Audio/ }));
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
