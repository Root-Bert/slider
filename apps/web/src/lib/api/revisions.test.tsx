import type { DeletedSlide } from '@slider/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api-client';
import { useDeletedSlides } from './revisions';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDeletedSlides', () => {
  it('keeps the previous revision’s list while the new one loads – not another deck’s', async () => {
    const first = [{ slideId: 'gone' } as DeletedSlide];
    let resolveNext: (value: DeletedSlide[]) => void = () => {};
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce(first)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve as (value: DeletedSlide[]) => void;
          }),
      );
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ deckId, revisionId }) => useDeletedSlides(deckId, revisionId),
      { wrapper, initialProps: { deckId: 'd1', revisionId: 'r1' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(first));

    rerender({ deckId: 'd1', revisionId: 'r2' });
    expect(result.current.data).toEqual(first);
    expect(result.current.isPlaceholderData).toBe(true);
    resolveNext([]);
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).toEqual([]);

    rerender({ deckId: 'd2', revisionId: 'r9' });
    expect(result.current.data).toBeUndefined();
    client.clear();
  });
});
