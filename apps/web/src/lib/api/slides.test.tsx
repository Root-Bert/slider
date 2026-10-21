import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api-client';
import { SIGNED_URL_STALE_MS } from './revisions';
import { useSlides } from './slides';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSlides', () => {
  it('fetches the slides again before their signed image URLs expire, without a focus change', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useSlides('d1'), { wrapper });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(SIGNED_URL_STALE_MS));
    expect(get).toHaveBeenCalledTimes(2);
    // Well inside the shortest lifetime of a signed URL (6 h).
    expect(SIGNED_URL_STALE_MS).toBeLessThan(6 * 60 * 60_000);
    client.clear();
  });
});
