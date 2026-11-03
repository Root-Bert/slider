import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORED_ANSWER_HEADER, api } from '@/lib/api-client';
import { createQueryClient } from './query-client';

/** The API by hand: each answer from the server, or from the service worker's store. */
function answering(body: unknown, fromStore: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          headers: {
            'Content-Type': 'application/json',
            ...(fromStore && { [STORED_ANSWER_HEADER]: '1' }),
          },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stored answers in queries', () => {
  const key = ['edit', 'deck'];
  const fetchEdit = (client: ReturnType<typeof createQueryClient>) =>
    client.fetchQuery({
      queryKey: key,
      queryFn: () => api.get<{ seq: number }>('/decks/deck/edit'),
      staleTime: 0,
      retry: false,
    });

  it('takes a stored answer only without newer data, and asks again once the server answers', async () => {
    const offline = createQueryClient(() => {});
    answering({ seq: 3 }, true);
    expect(await fetchEdit(offline)).toEqual({ seq: 3 });
    expect(offline.getQueryState(key)?.isInvalidated).toBe(false);
    // Another query gets the server's own answer: the server is back.
    answering({ ok: true }, false);
    await offline.fetchQuery({ queryKey: ['other'], queryFn: () => api.get('/other') });
    expect(offline.getQueryState(key)?.isInvalidated).toBe(true);

    // Newer data is kept over a stored answer – no error, the same data.
    const client = createQueryClient(() => {});
    const held = { seq: 5 };
    client.setQueryData(key, held);
    answering({ seq: 3 }, true);
    expect(await fetchEdit(client)).toBe(held);
    expect(client.getQueryState(key)?.status).toBe('success');
    // The server's own answer is taken as always.
    answering({ seq: 6 }, false);
    expect(await fetchEdit(client)).toEqual({ seq: 6 });
  });
});
