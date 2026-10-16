import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makeDeck } from '../lib/deck-fixture';
import { DeckCard } from './DeckCard';

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
  it('opens the deck actions from a ⋯ button, not only from a right click', async () => {
    render(
      <MemoryRouter>
        <DeckCard deck={makeDeck()} onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Q4 Strategie“' }));
    expect(screen.getByRole('menuitem', { name: 'Umbenennen' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeTruthy();
  });

  it('after renaming in place with Escape, the focus is back on the title link', async () => {
    render(
      <MemoryRouter>
        <DeckCard deck={makeDeck()} onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Q4 Strategie“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Umbenennen' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name der Review' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Q4 Strategie' }));
  });
});
