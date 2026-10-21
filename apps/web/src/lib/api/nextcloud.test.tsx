import type { Deck } from '@slider/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { useImportNextcloudItem } from './nextcloud';

afterEach(() => vi.restoreAllMocks());

describe('useImportNextcloudItem', () => {
  it('caches the imported deck and refreshes the deck lists', async () => {
    const deck = { id: 'd1' } as Deck;
    vi.spyOn(api, 'post').mockResolvedValue(deck);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useImportNextcloudItem('w1'), { wrapper });
    await act(() => result.current.mutateAsync({ connectionId: 'c1', fileId: 'f1' }));
    expect(client.getQueryData(queryKeys.deck('d1'))).toBe(deck);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.deckLists });
    client.clear();
  });
});
