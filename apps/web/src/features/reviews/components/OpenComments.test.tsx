import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment } from '@slider/shared';
import { makeDeck, owner } from '../lib/deck-fixture';
import { OpenCommentsButton } from './OpenComments';

const api = vi.hoisted(() => ({
  comments: { isPending: false, isError: false, data: [] as Comment[] },
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: api.invalidate }),
}));
vi.mock('@/lib/api', () => ({
  queryKeys: { deckLists: ['decks'] },
  useComments: () => api.comments,
  useSlides: () => ({ data: [{ id: 's1', hidden: false }] }),
  useUpdateComment: () => ({ mutate: api.mutate }),
}));

const comment = (id: string, overrides: Partial<Comment> = {}): Comment => ({
  id,
  deckId: 'd1',
  slideId: 's1',
  parentId: null,
  author: owner,
  body: `Kommentar ${id}`,
  anchor: { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
  strokes: [],
  media: null,
  status: 'open',
  resolvedBy: null,
  resolvedAt: null,
  source: 'app',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
});

function setup(props: Partial<Parameters<typeof OpenCommentsButton>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter>
      <OpenCommentsButton
        deck={makeDeck({ openCommentCount: 2 })}
        onOpenChange={onOpenChange}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onOpenChange };
}

const trigger = () => screen.getByRole('button', { name: '2 offene Kommentare anzeigen' });

describe('OpenCommentsButton', () => {
  beforeEach(() => {
    api.comments = {
      isPending: false,
      isError: false,
      data: [
        comment('c1'),
        comment('c2', { body: 'Zweiter' }),
        comment('r1', { parentId: 'c1', body: 'Antwort' }),
        comment('c3', { status: 'done' }),
      ],
    };
    api.mutate.mockReset();
  });

  it('renders nothing when no thread is open', () => {
    render(
      <MemoryRouter>
        <OpenCommentsButton deck={makeDeck({ openCommentCount: 0 })} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the list as a labelled region it controls and reports the open state', async () => {
    const { onOpenChange } = setup();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toContain('2 offen');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    await userEvent.click(trigger());
    const region = screen.getByRole('region', { name: 'Offene Kommentare' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(region.id);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    // Open roots only: the resolved one and the reply are not rows of their own.
    expect(screen.getByText('2 von 2 offen')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Als erledigt markieren' })).toHaveLength(2);
  });

  it('Escape closes the list and hands the focus back to the trigger', async () => {
    setup();
    await userEvent.click(trigger());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Offene Kommentare' })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('a press outside closes the list; one inside keeps it open', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    setup();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByText('2 von 2 offen'));
    expect(screen.getByRole('region', { name: 'Offene Kommentare' })).toBeTruthy();
    await userEvent.click(outside);
    expect(screen.queryByRole('region', { name: 'Offene Kommentare' })).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    outside.remove();
  });

  it('a second click on the trigger closes the list again', async () => {
    const { onOpenChange } = setup();
    await userEvent.click(trigger());
    await userEvent.click(trigger());
    expect(screen.queryByRole('region', { name: 'Offene Kommentare' })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('ticks a thread off in place and can undo it', async () => {
    setup();
    await userEvent.click(trigger());
    const [first] = screen.getAllByRole('button', { name: 'Als erledigt markieren' });
    expect(first!.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(first!);
    expect(api.mutate).toHaveBeenLastCalledWith(
      { commentId: 'c1', status: 'done' },
      expect.anything(),
    );
    const undo = screen.getByRole('button', { name: 'Wieder öffnen' });
    expect(undo.getAttribute('aria-pressed')).toBe('true');
    expect(undo.getAttribute('title')).toBe('Erledigt – klicken zum Wiederöffnen');
    expect(screen.getByText('1 von 2 offen')).toBeTruthy();
    expect(screen.getByText('Kommentar c1').className).toContain('line-through');

    await userEvent.click(undo);
    expect(api.mutate).toHaveBeenLastCalledWith(
      { commentId: 'c1', status: 'open' },
      expect.anything(),
    );
  });

  it('a tick that could not be saved goes back to open and says why', async () => {
    const onNotify = vi.fn();
    api.mutate.mockImplementation((_vars, options: { onError?: (error: Error) => void }) =>
      options.onError?.(new Error('Keine Verbindung zum Server.')),
    );
    setup({ onNotify });
    await userEvent.click(trigger());
    const [first] = screen.getAllByRole('button', { name: 'Als erledigt markieren' });
    await userEvent.click(first!);
    expect(screen.getByText('2 von 2 offen')).toBeTruthy();
    expect(screen.getByText('Kommentar c1').className).not.toContain('line-through');
    expect(onNotify).toHaveBeenCalledWith('Keine Verbindung zum Server.', 'danger');
  });

  it('folds replies behind a disclosure', async () => {
    setup();
    await userEvent.click(trigger());
    const toggle = screen.getByRole('button', { name: /1 Antwort/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Antwort')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const replies = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(replies?.textContent).toContain('Antwort');
  });

  it('hides the tick boxes without comment rights; rows link into the deck', async () => {
    setup({
      deck: makeDeck({ openCommentCount: 2, permissions: { canManage: false, canComment: false } }),
    });
    await userEvent.click(trigger());
    expect(screen.queryByRole('button', { name: 'Als erledigt markieren' })).toBeNull();
    // Links into the deck at the comment's slide.
    expect(screen.getAllByRole('link')[0]!.getAttribute('href')).toContain('d1');
  });

  it('shows a spinner while loading', async () => {
    api.comments = { isPending: true, isError: false, data: [] };
    setup();
    await userEvent.click(trigger());
    expect(screen.getByRole('status', { name: 'Lädt' })).toBeTruthy();
  });

  it('shows the error message when the comments fail to load', async () => {
    api.comments = { isPending: false, isError: true, data: [] };
    setup();
    await userEvent.click(trigger());
    expect(screen.getByText('Kommentare konnten nicht geladen werden.')).toBeTruthy();
  });

  it('portals the card list into the thumbnail slot', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    setup({ placement: 'card', size: 'md', cardSlot: slot });
    await userEvent.click(trigger());
    expect(slot.querySelector('section')?.id).toBe(trigger().getAttribute('aria-controls'));
    // A click inside the portalled list doesn't count as outside.
    await userEvent.click(screen.getByText('2 von 2 offen'));
    expect(slot.querySelector('section')).toBeTruthy();
    slot.remove();
  });
});
