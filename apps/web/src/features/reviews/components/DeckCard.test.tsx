import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { DeckCard, DeckRow } from './DeckCard';

const idle = { mutate: vi.fn(), isPending: false };
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/api', () => ({
  queryKeys: { deckLists: ['decks'] },
  useComments: () => ({ isPending: false, isError: false, data: [] }),
  useSlides: () => ({ data: [] }),
  useUpdateComment: () => idle,
  useUpdateDeck: () => idle,
  useRerenderDeck: () => idle,
  useInvalidateSlideImages: () => vi.fn(),
  useDeckStatus: () => ({ data: undefined, dataUpdatedAt: 0 }),
  useMe: () => ({ data: { user: { id: 'u1' } } }),
}));

describe('DeckCard', () => {
  it('has no ⋯ button on the thumbnail; a right click opens the deck actions', async () => {
    render(
      <MemoryRouter>
        <DeckCard deck={makeDeck()} onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Aktionen für „Q4 Strategie“' })).toBeNull();
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Q4 Strategie' }));
    expect(screen.getByRole('menuitem', { name: 'Umbenennen' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeTruthy();
  });

  it('after renaming in place with Escape, the focus is back on the title link', async () => {
    render(
      <MemoryRouter>
        <DeckCard deck={makeDeck()} onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Q4 Strategie' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Umbenennen' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name der Review' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Q4 Strategie' }));
  });

  it('offers "Zugriff einschränken …" only to those who manage the deck', () => {
    for (const canManage of [true, false]) {
      const { unmount } = render(
        <MemoryRouter>
          <DeckRow
            deck={makeDeck({ permissions: { canManage, canComment: true } })}
            onNotify={vi.fn()}
          />
        </MemoryRouter>,
      );
      fireEvent.contextMenu(screen.getByRole('link', { name: 'Q4 Strategie' }));
      expect(Boolean(screen.queryByRole('menuitem', { name: 'Zugriff einschränken …' }))).toBe(
        canManage,
      );
      unmount();
    }
  });

  it('offers "Neu rendern" to everyone who may comment, not to viewers (BER-165)', () => {
    for (const canComment of [true, false]) {
      const { unmount } = render(
        <MemoryRouter>
          <DeckRow
            deck={makeDeck({ permissions: { canManage: false, canComment } })}
            onNotify={vi.fn()}
          />
        </MemoryRouter>,
      );
      fireEvent.contextMenu(screen.getByRole('link', { name: 'Q4 Strategie' }));
      expect(Boolean(screen.queryByRole('menuitem', { name: 'Neu rendern' }))).toBe(canComment);
      expect(screen.queryByRole('menuitem', { name: 'Löschen' })).toBeNull();
      unmount();
    }
  });

  it('marks restricted decks with a lock on cards and rows', () => {
    for (const Item of [DeckCard, DeckRow]) {
      const { unmount } = render(
        <MemoryRouter>
          <Item deck={makeDeck({ restricted: true })} onNotify={vi.fn()} />
          <Item deck={makeDeck({ id: 'd2', title: 'Offen' })} onNotify={vi.fn()} />
        </MemoryRouter>,
      );
      expect(screen.getAllByRole('img', { name: 'Zugriff eingeschränkt' })).toHaveLength(1);
      unmount();
    }
  });
});
