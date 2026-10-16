import type { Author } from '@slider/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { author } from '../lib/test-fixtures';
import { ParticipantAvatars } from './ParticipantAvatars';

/** `LONG_PRESS_MS` in the component. */
const LONG_PRESS_MS = 500;

const mocks = vi.hoisted(() => ({
  data: {
    deck: { participants: [] as Author[] },
    viewer: { author: null as unknown as Author },
    slideIndex: new Map([
      ['s1', 0],
      ['s2', 1],
      ['s3', 2],
    ]),
  },
  state: { personFilter: null as string | null },
  dispatch: vi.fn(),
  live: [] as { author: Author; activeSlideId: string | null }[],
  overrides: {} as Record<string, string>,
  setColorOverride: vi.fn(),
  goToSlide: vi.fn(),
  updateMe: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('../state/viewer-data', () => ({ useViewerData: () => mocks.data }));
vi.mock('../state/viewer-state', () => ({
  useViewerState: () => mocks.state,
  useViewerDispatch: () => mocks.dispatch,
}));
vi.mock('../live/lib/live-people', () => ({ useLivePeople: () => mocks.live }));
vi.mock('../hooks/useColorOverrides', () => ({ useColorOverrides: () => mocks.overrides }));
vi.mock('../lib/color-overrides', () => ({ setColorOverride: mocks.setColorOverride }));
vi.mock('../hooks/useGoToSlide', () => ({ useGoToSlide: () => mocks.goToSlide }));
vi.mock('@/lib/api', () => ({ useUpdateMe: () => mocks.updateMe }));

const me = author('me', { name: 'Robert', color: 'violet' });
const anna = author('anna', { name: 'Anna', color: 'green' });
const ppt = author('ppt', { name: 'PowerPoint-Autor', type: 'external', color: 'red' });

const avatar = (name: string | RegExp) => screen.getByRole('button', { name });
const ownAvatar = () => avatar('Kommentare zeigen, in denen du erwähnt wirst');

describe('ParticipantAvatars', () => {
  beforeEach(() => {
    mocks.data.deck.participants = [anna];
    mocks.data.viewer.author = me;
    mocks.state.personFilter = null;
    mocks.live = [];
    mocks.overrides = {};
    mocks.updateMe.isPending = false;
    mocks.updateMe.isError = false;
    mocks.updateMe.error = null;
    for (const fn of [mocks.dispatch, mocks.setColorOverride, mocks.goToSlide]) fn.mockReset();
    mocks.updateMe.mutate.mockReset();
  });

  it('lists the others, then you, in a labelled group', () => {
    render(<ParticipantAvatars />);
    const group = screen.getByRole('group', { name: 'Teilnehmende' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Nur Kommentare von Anna',
      'Kommentare zeigen, in denen du erwähnt wirst',
    ]);
  });

  it('puts people in the deck right now first, with a live dot, and never you twice', () => {
    mocks.data.deck.participants = [anna, author('ben', { name: 'Ben' })];
    mocks.live = [
      { author: author('ben', { name: 'Ben' }), activeSlideId: 's2' },
      { author: me, activeSlideId: 's1' },
    ];
    render(<ParticipantAvatars />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Nur Kommentare von Ben',
      'Nur Kommentare von Anna',
      'Kommentare zeigen, in denen du erwähnt wirst',
    ]);
    expect(within(avatar('Nur Kommentare von Ben')).getByLabelText('gerade da')).toBeTruthy();
    expect(within(avatar('Nur Kommentare von Anna')).queryByLabelText('gerade da')).toBeNull();
  });

  it('shows five others and a "+n" chip naming the rest; six fit without a chip', () => {
    const people = Array.from({ length: 8 }, (_, i) => author(`p${i}`, { name: `P${i}` }));
    mocks.data.deck.participants = people;
    const { unmount } = render(<ParticipantAvatars />);
    expect(screen.getAllByRole('button', { name: /^Nur Kommentare von/ })).toHaveLength(5);
    const chip = screen.getByText('+3');
    expect(chip.getAttribute('title')).toBe('P5, P6, P7');
    unmount();

    mocks.data.deck.participants = people.slice(0, 6);
    render(<ParticipantAvatars />);
    expect(screen.getAllByRole('button', { name: /^Nur Kommentare von/ })).toHaveLength(6);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  it('a click toggles the person filter; the pressed avatar says what is showing', async () => {
    const { rerender } = render(<ParticipantAvatars />);
    await userEvent.click(avatar('Nur Kommentare von Anna'));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'personFilterToggled',
      authorId: 'anna',
    });

    mocks.state.personFilter = 'anna';
    rerender(<ParticipantAvatars />);
    const pressed = avatar('Nur Kommentare von Anna');
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(ownAvatar().getAttribute('aria-pressed')).toBe('false');
    const tooltips = screen.getAllByRole('tooltip').map((tip) => tip.textContent);
    expect(tooltips).toContain('AnnaNur Kommentare dieser Person');
    expect(tooltips).toContain('Robert (du)');
  });

  it('right-clicking your own avatar picks your account colour', async () => {
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(ownAvatar());
    const dialog = screen.getByRole('dialog', { name: 'Deine Farbe' });
    const swatches = within(dialog).getByRole('radiogroup', { name: 'Deine Farbe' });
    expect(
      within(swatches).getByRole('radio', { name: 'Violett' }).getAttribute('aria-checked'),
    ).toBe('true');
    // No tooltip while the picker is open.
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);

    await userEvent.click(within(swatches).getByRole('radio', { name: 'Violett' }));
    expect(mocks.updateMe.mutate).not.toHaveBeenCalled();
    await userEvent.click(within(swatches).getByRole('radio', { name: 'Grün' }));
    expect(mocks.updateMe.mutate).toHaveBeenCalledExactlyOnceWith({ color: 'green' });
    expect(mocks.setColorOverride).not.toHaveBeenCalled();
    expect(within(dialog).queryByText('Nur für dich sichtbar.')).toBeNull();
  });

  it('shows the save error and waits while saving', () => {
    mocks.updateMe.isPending = true;
    mocks.updateMe.isError = true;
    mocks.updateMe.error = new Error('Speichern fehlgeschlagen');
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(ownAvatar());
    expect(screen.getByRole('alert').textContent).toBe('Speichern fehlgeschlagen');
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("someone else's colour is a local override that can be reset", async () => {
    mocks.overrides = { anna: 'cyan' };
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(avatar('Nur Kommentare von Anna'));
    const dialog = screen.getByRole('dialog', { name: 'Farbe für Anna' });
    expect(within(dialog).getByText(/Nur für dich sichtbar\./)).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Blau' }));
    expect(mocks.setColorOverride).toHaveBeenCalledWith('anna', 'blue');
    expect(mocks.updateMe.mutate).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücksetzen' }));
    expect(mocks.setColorOverride).toHaveBeenLastCalledWith('anna', null);
  });

  it('offers "Zurücksetzen" only for an overridden colour', () => {
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(avatar('Nur Kommentare von Anna'));
    expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).toBeNull();
  });

  it('jumps to a live person’s slide and closes', async () => {
    mocks.live = [{ author: anna, activeSlideId: 's3' }];
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(avatar('Nur Kommentare von Anna'));
    await userEvent.click(screen.getByRole('button', { name: 'Zu Folie 3 springen' }));
    expect(mocks.goToSlide).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PowerPoint authors have no picker – only a jump while they are live', () => {
    mocks.data.deck.participants = [ppt];
    const { unmount } = render(<ParticipantAvatars />);
    const trigger = avatar('Nur Kommentare von PowerPoint-Autor');
    expect(fireEvent.contextMenu(trigger)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    mocks.live = [{ author: ppt, activeSlideId: 's1' }];
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(avatar('Nur Kommentare von PowerPoint-Autor'));
    const dialog = screen.getByRole('dialog', { name: 'PowerPoint-Autor' });
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Zu Folie 1 springen' })).toBeTruthy();
  });

  it('Escape closes the picker and hands the focus back to the avatar', async () => {
    render(<ParticipantAvatars />);
    fireEvent.contextMenu(ownAvatar());
    screen.getByRole('radio', { name: 'Grün' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(ownAvatar());
  });

  it('a second right click closes it again', () => {
    render(<ParticipantAvatars />);
    // The right click opens the picker instead of the browser's context menu.
    expect(fireEvent.contextMenu(ownAvatar())).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.contextMenu(ownAvatar());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a press outside closes the picker; a press inside keeps it open', async () => {
    render(
      <>
        <ParticipantAvatars />
        <button type="button">Draußen</button>
      </>,
    );
    fireEvent.contextMenu(ownAvatar());
    const dialog = screen.getByRole('dialog', { name: 'Deine Farbe' });
    await userEvent.click(within(dialog).getByText('Deine Farbe'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Draußen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a plain click on an avatar filters without opening the picker', async () => {
    render(<ParticipantAvatars />);
    await userEvent.click(ownAvatar());
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'personFilterToggled',
      authorId: 'me',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Shift+F10 opens the picker from the keyboard (macOS has no menu key) and focuses it', async () => {
    mocks.live = [{ author: anna, activeSlideId: 's2' }];
    render(<ParticipantAvatars />);
    const trigger = avatar('Nur Kommentare von Anna');
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
    trigger.focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    const dialog = screen.getByRole('dialog', { name: 'Farbe für Anna' });
    expect(within(dialog).getByRole('radio', { name: 'Grün' })).toBe(document.activeElement);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zu Folie 2 springen' }));
    expect(mocks.goToSlide).toHaveBeenCalledWith(1);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('the menu key opens it too', () => {
    render(<ParticipantAvatars />);
    expect(fireEvent.keyDown(ownAvatar(), { key: 'ContextMenu' })).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Deine Farbe' })).toBeTruthy();
  });

  it('a long press on touch opens the picker instead of filtering; a tap still filters', () => {
    vi.useFakeTimers();
    try {
      render(<ParticipantAvatars />);
      const trigger = avatar('Nur Kommentare von Anna');
      const touch = { pointerType: 'touch', clientX: 10, clientY: 10 };

      fireEvent.pointerDown(trigger, touch);
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.getByRole('dialog', { name: 'Farbe für Anna' })).toBeTruthy();
      fireEvent.pointerUp(trigger, touch);
      // Android follows with its own contextmenu: the picker stays open.
      fireEvent.contextMenu(trigger);
      fireEvent.click(trigger);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(mocks.dispatch).not.toHaveBeenCalled();

      fireEvent.pointerDown(trigger, touch);
      act(() => vi.advanceTimersByTime(100));
      fireEvent.pointerUp(trigger, touch);
      fireEvent.click(trigger);
      expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'personFilterToggled',
        authorId: 'anna',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a touch that moves (a scroll) opens nothing', () => {
    vi.useFakeTimers();
    try {
      render(<ParticipantAvatars />);
      const trigger = avatar('Nur Kommentare von Anna');
      fireEvent.pointerDown(trigger, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerMove(trigger, { pointerType: 'touch', clientX: 10, clientY: 40 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
