import type { Deck } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { author } from '../lib/test-fixtures';
import { ImportFailed } from './ImportProgress';

const remove = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  error: null as Error | null,
}));
vi.mock('@/lib/api', () => ({ useDeleteDeck: () => remove }));

const deck = (canManage: boolean): Deck => ({
  id: 'd1',
  workspaceId: 'w2',
  title: 'Q4',
  fileName: 'q4.pptx',
  source: 'upload',
  owner: author('owner', { name: 'Olga Owner' }),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  revisionNumber: 1,
  slideCount: 0,
  openCommentCount: 0,
  thumbnailUrl: null,
  participants: [],
  import: { status: 'failed', error: 'Die Datei ist beschädigt.' } as Deck['import'],
  permissions: { canManage, canComment: true },
});

function setup(canManage: boolean) {
  const router = createMemoryRouter(
    [
      { path: '/d/:deckId', element: <ImportFailed deck={deck(canManage)} error="kaputt" /> },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: ['/d/d1'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => remove.mutate.mockReset());

describe('ImportFailed', () => {
  it('offers removing and another upload – into the deck’s own workspace', async () => {
    const router = setup(true);
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Andere Datei hochladen' }));
    expect(router.state.location.pathname).toBe('/neu');
    expect(router.state.location.search).toBe('?workspace=w2');
  });

  it('goes back to the deck’s workspace once removed', async () => {
    const router = setup(true);
    remove.mutate.mockImplementation((_id: string, options: { onSuccess: () => void }) =>
      options?.onSuccess(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(remove.mutate).toHaveBeenCalledWith('d1', expect.anything());
    expect(router.state.location.pathname).toBe('/w/w2');
  });

  it('offers neither to someone who may not manage the deck, but says who can', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Andere Datei hochladen' })).toBeNull();
    expect(screen.getByText('Bitte Olga Owner, die Präsentation erneut hochzuladen.')).toBeTruthy();
  });
});
