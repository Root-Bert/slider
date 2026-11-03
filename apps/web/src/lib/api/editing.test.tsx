import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SlideLayers } from '@slider/shared';
import { describe, expect, it, vi } from 'vitest';
import { slideLayersQuery, useSlideLayers } from './editing';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api-client', () => ({
  api: { post: mocks.post },
  isStoredAnswer: () => false,
  apiRequestAnswer: vi.fn(),
  unreachableError: () => new Error('offline'),
}));

describe('render queue priority', () => {
  it('promotes an in-flight background render when a drag starts, without replacing the cache owner', async () => {
    let complete!: (data: SlideLayers) => void;
    const pending = new Promise<SlideLayers>((resolve) => {
      complete = resolve;
    });
    mocks.post.mockReset();
    mocks.post.mockReturnValue(pending);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const background = client.fetchQuery(slideLayersQuery('deck', 'slide', 1, 'background'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender, unmount } = renderHook(
      () =>
        useSlideLayers('deck', 'slide', 1, {
          enabled: true,
          priority: 'interactive',
        }),
      { wrapper },
    );
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post).toHaveBeenLastCalledWith('/decks/deck/edit/slides/slide/layers', {
      priority: 'interactive',
    });
    rerender();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    const data: SlideLayers = { seq: 1, background: '/background', layers: [] };
    await act(async () => {
      complete(data);
      await background;
    });
    await waitFor(() => expect(result.current.data).toEqual(data));
    unmount();
    client.clear();
  });
});
