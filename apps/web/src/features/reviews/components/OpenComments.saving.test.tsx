import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Comment } from '@slider/shared';
import { api } from '@/lib/api-client';
import { makeDeck, owner } from '../lib/deck-fixture';
import { OpenCommentsButton } from './OpenComments';

// The real mutation hooks: what is tested here is how TanStack Query calls back per `mutate`.

const comment = (id: string): Comment => ({
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
});

afterEach(() => vi.restoreAllMocks());

describe('OpenCommentsButton saving', () => {
  it('a failed tick still rolls back and says so when another row was ticked meanwhile', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      path.endsWith('/comments') ? [comment('c1'), comment('c2')] : [{ id: 's1', hidden: false }],
    );
    let failFirst: (error: Error) => void = () => {};
    vi.spyOn(api, 'patch')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockImplementationOnce(async () => ({ ...comment('c2'), status: 'done' }));
    const onNotify = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OpenCommentsButton deck={makeDeck({ openCommentCount: 2 })} onNotify={onNotify} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '2 offene Kommentare anzeigen' }));
    const [first, second] = await screen.findAllByRole('button', {
      name: 'Als erledigt markieren',
    });
    await userEvent.click(first!);
    await userEvent.click(second!);
    expect(screen.getByText('0 von 2 offen')).toBeTruthy();

    await act(async () => failFirst(new Error('Zu viele Anfragen.')));
    expect(onNotify).toHaveBeenCalledWith('Zu viele Anfragen.', 'danger');
    expect(screen.getByText('Kommentar c1').className).not.toContain('line-through');
    expect(screen.getByText('Kommentar c2').className).toContain('line-through');
    client.clear();
  });
});
