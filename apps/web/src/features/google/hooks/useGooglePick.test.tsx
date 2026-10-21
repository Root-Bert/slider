import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGooglePick } from './useGooglePick';

function setup() {
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: 'deck-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const assign = vi.fn();
  vi.stubGlobal('location', {
    href: 'http://localhost/neu?workspace=ws1&google=pick&googleFile=f1&googlePicked=f0',
    assign,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const onImported = vi.fn();
  const hook = renderHook(() => useGooglePick('ws1', onImported), { wrapper });
  return { hook, assign, requests, onImported };
}

afterEach(() => vi.unstubAllGlobals());

describe('useGooglePick (BER-158)', () => {
  it("leaves for Google's picker page and comes back to this page, without the last return", () => {
    const { hook, assign } = setup();
    act(() => hook.result.current.open('1SlidesAbCd'));
    expect(assign).toHaveBeenCalledWith(
      `/api/auth/google/pick?returnTo=${encodeURIComponent('/neu?workspace=ws1')}&fileId=1SlidesAbCd`,
    );
    expect(hook.result.current.pending).toBe(true);
  });

  it('imports the file picked there', async () => {
    const { hook, requests, onImported } = setup();
    act(() => hook.result.current.importPicked('c1', '1SlidesAbCd'));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'deck-1' }));
    expect(requests).toEqual([
      {
        url: '/api/decks/google-item',
        body: { connectionId: 'c1', fileId: '1SlidesAbCd', workspaceId: 'ws1' },
      },
    ]);
  });
});
