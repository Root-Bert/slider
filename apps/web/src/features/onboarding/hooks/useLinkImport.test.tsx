import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVALID_LINK_MESSAGE, useLinkImport } from './useLinkImport';

const NEXTCLOUD_LINK = 'https://cloud.example.org/s/AbCdEfGh';

function setup() {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'nextcloud_login_required',
            message: 'Verbinde dein Nextcloud-Konto.',
            nextcloudServer: 'https://cloud.example.org',
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useLinkImport('ws1', vi.fn()), { wrapper });
  return { fetchMock, hook };
}

describe('useLinkImport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses OneDrive and Google links; a Nextcloud link without access asks to connect that Nextcloud', async () => {
    const { fetchMock, hook } = setup();
    act(() => hook.result.current.change('https://1drv.ms/p/c/abc123/EaB3kQ'));
    act(() => hook.result.current.submit());
    expect(hook.result.current.error).toBe(INVALID_LINK_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => hook.result.current.change(NEXTCLOUD_LINK));
    act(() => hook.result.current.submit());
    await waitFor(() => expect(hook.result.current.noAccess).not.toBeNull());
    expect(hook.result.current.noAccess).toMatchObject({
      kind: 'nextcloud',
      host: 'cloud.example.org',
      nextcloudServer: 'https://cloud.example.org',
    });
  });
});
