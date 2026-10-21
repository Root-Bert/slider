import type { DeckStatus } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { bulkRerenderProgress } from './bulk-rerender';

const status = (rendering: DeckStatus['rendering']) => ({ rendering }) as DeckStatus;

describe('bulkRerenderProgress', () => {
  const startedAt = 1_000;

  it('counts a deck as done only from a status fetched after the start', () => {
    const progress = bulkRerenderProgress(
      [
        { data: status(null), dataUpdatedAt: 900, error: null },
        { data: status(null), dataUpdatedAt: 1_100, error: null },
        {
          data: status({ status: 'running', done: 1, total: 4 }),
          dataUpdatedAt: 1_100,
          error: null,
        },
      ],
      startedAt,
    );
    expect(progress).toEqual({ done: 1, gone: 0, finished: false });
  });

  it('settles decks that were deleted or became inaccessible meanwhile (4xx)', () => {
    const progress = bulkRerenderProgress(
      [
        { data: status(null), dataUpdatedAt: 1_100, error: null },
        // The last good data still says "queued" – TanStack keeps it next to the error.
        {
          data: status({ status: 'queued', done: 0, total: 0 }),
          dataUpdatedAt: 900,
          error: new ApiError(404, 'not_found', 'Nicht gefunden'),
        },
        {
          data: undefined,
          dataUpdatedAt: 0,
          error: new ApiError(403, 'forbidden', 'Kein Zugriff'),
        },
      ],
      startedAt,
    );
    expect(progress).toEqual({ done: 1, gone: 2, finished: true });
  });

  it('keeps waiting through a server or network hiccup', () => {
    const progress = bulkRerenderProgress(
      [{ data: undefined, dataUpdatedAt: 0, error: new ApiError(503, 'bad_request', 'Weg') }],
      startedAt,
    );
    expect(progress.finished).toBe(false);
  });
});
