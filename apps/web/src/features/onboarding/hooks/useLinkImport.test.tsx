import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberLinkLogin } from '../lib/link-login';
import { useLinkImport } from './useLinkImport';

const LINK = 'https://contoso.sharepoint.com/sites/x/Shared%20Documents/secret.pptx';

function setup(search: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'd1' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/neu${search}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const onImported = vi.fn();
  const hook = renderHook(() => useLinkImport('ws1', onImported), { wrapper });
  return { fetchMock, onImported, hook };
}

const importCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/decks/link'));

describe('useLinkImport – back from the Microsoft login', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('a crafted /neu?link=… only prefills the field, it never imports on its own', async () => {
    const { fetchMock, hook } = setup(`?link=${encodeURIComponent(LINK)}&workspace=ws1`);
    expect(hook.result.current.url).toBe(LINK);
    await act(async () => {});
    expect(importCalls(fetchMock)).toHaveLength(0);
    expect(hook.result.current.pending).toBe(false);
  });

  it('imports once when this tab started the login for this link and workspace', async () => {
    rememberLinkLogin(LINK, 'ws1');
    const { fetchMock, onImported } = setup(`?link=${encodeURIComponent(LINK)}`);
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(importCalls(fetchMock)).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not import into another workspace than the login was started in', async () => {
    rememberLinkLogin(LINK, 'other-ws');
    const { fetchMock } = setup(`?link=${encodeURIComponent(LINK)}`);
    await act(async () => {});
    expect(importCalls(fetchMock)).toHaveLength(0);
  });

  it('"Mit Microsoft anmelden" remembers the link before leaving for the login', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { hook } = setup(`?link=${encodeURIComponent(LINK)}&msError=denied`);
    expect(hook.result.current.noAccess?.loginUrl).toBeTruthy();
    act(() => hook.result.current.signIn());
    expect(assign).toHaveBeenCalledWith(hook.result.current.noAccess?.loginUrl);
    expect(sessionStorage.getItem('slider.linkLogin')).toContain('ws1');
  });
});
