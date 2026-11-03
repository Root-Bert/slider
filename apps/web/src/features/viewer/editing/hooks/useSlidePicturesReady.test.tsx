import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/api';
import { useSlidePicturesReady } from './useSlidePicturesReady';

it('keeps live previews until the invalidated slide refresh succeeds, including after a failed refresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = queryKeys.slides('deck');
  client.setQueryData(queryKey, ['/intermediate-slide']);
  let finish!: (data: string[]) => void;
  let fail!: (error: Error) => void;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => {
      useQuery({
        queryKey,
        staleTime: Infinity,
        queryFn: () =>
          new Promise<string[]>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      });
      return useSlidePicturesReady('deck');
    },
    { wrapper },
  );
  expect(result.current).toBe(true);
  act(() => {
    void client.invalidateQueries({ queryKey });
  });
  await waitFor(() => expect(result.current).toBe(false));
  expect(client.getQueryData(queryKey)).toEqual(['/intermediate-slide']);
  await act(async () => {
    fail(new Error('Network unavailable'));
  });
  await waitFor(() => expect(client.isFetching({ queryKey })).toBe(0));
  expect(result.current).toBe(false);
  act(() => {
    void client.invalidateQueries({ queryKey });
  });
  await waitFor(() => expect(client.isFetching({ queryKey })).toBe(1));
  await act(async () => {
    finish(['/latest-slide']);
  });
  await waitFor(() => expect(result.current).toBe(true));
  expect(client.getQueryData(queryKey)).toEqual(['/latest-slide']);
  unmount();
  // Refreshed, but the slides on screen not handed it yet (their observers a render behind):
  // not ready – the live drawing would end over the old picture.
  client.setQueryData(queryKey, [{ id: 's1', imageUrl: '/new' }]);
  const behind = renderHook(({ shown }) => useSlidePicturesReady('deck', shown), {
    wrapper,
    initialProps: { shown: [{ id: 's1', imageUrl: '/old' }] },
  });
  expect(behind.result.current).toBe(false);
  behind.rerender({ shown: [{ id: 's1', imageUrl: '/new' }] });
  expect(behind.result.current).toBe(true);
  behind.unmount();
  client.clear();
});

it('observes invalidation synchronously after settling, even when the refresh cannot start yet', async () => {
  const client = new QueryClient();
  const queryKey = queryKeys.slides('deck');
  client.setQueryData(queryKey, ['/intermediate-slide']);
  const handoff = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => {
      const [settled, setSettled] = useState(false);
      const ready = useSlidePicturesReady('deck');
      useEffect(() => {
        if (settled && ready) handoff();
      }, [settled, ready]);
      return {
        ready,
        settle: () => {
          // Same order as the outbox: listener.settled, then transport.answered.
          setSettled(true);
          void client.invalidateQueries({ queryKey });
        },
      };
    },
    { wrapper },
  );
  act(() => result.current.settle());
  // No active fetch exists here. Watching only the fetch count would miss invalidation.
  expect(client.isFetching({ queryKey })).toBe(0);
  expect(result.current.ready).toBe(false);
  expect(handoff).not.toHaveBeenCalled();
  act(() => client.setQueryData(queryKey, ['/latest-slide']));
  await waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
  unmount();
  client.clear();
});
