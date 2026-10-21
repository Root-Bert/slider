import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MicrosoftConnection } from '@slider/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOneDrivePicker } from './useOneDrivePicker';

const picker = vi.hoisted(() => ({ runPicker: vi.fn() }));
vi.mock('../lib/onedrive-picker', () => picker);

const connection = (id: string, patch: Partial<MicrosoftConnection> = {}): MicrosoftConnection => ({
  id,
  account: `${id}@firma.de`,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  deckCount: 0,
  needsReconnect: false,
  ...patch,
});

/** The API as far as the picker sees it; records every request. */
function stubApi(connections: MicrosoftConnection[]) {
  const requests: { url: string; body?: unknown }[] = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/me') {
        return json({
          viewer: { kind: 'owner', author: { id: 'u1', name: 'Anna', type: 'owner' } },
          user: { microsoftConnected: true, microsoftConnections: connections.length },
          instanceClaimed: true,
        });
      }
      if (url === '/api/me/microsoft') return json(connections);
      if (url.startsWith('/api/microsoft/file-picker/token')) return json({ token: 't' });
      if (url.startsWith('/api/microsoft/file-picker')) {
        return json({ account: 'business', baseUrl: 'https://x', pickerUrl: 'https://x/p' });
      }
      if (url === '/api/decks/drive-item') return json({ id: 'deck-1' });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  return requests;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/neu']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const onImported = vi.fn();
  const hook = renderHook(() => useOneDrivePicker('ws1', onImported), { wrapper });
  hook.result.current.dialog.frameRef.current = document.createElement('iframe');
  return { hook, onImported };
}

describe('useOneDrivePicker with several Microsoft accounts', () => {
  beforeEach(() => {
    picker.runPicker.mockReset();
    picker.runPicker.mockImplementation(
      async ({ getToken }: { getToken: (resource: string) => Promise<string> }) => {
        await getToken('https://contoso-my.sharepoint.com');
        return { driveId: 'b!d', itemId: 'i1' };
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the account first, then runs picker and import with it', async () => {
    const requests = stubApi([
      connection('c1'),
      connection('c2'),
      connection('c3', { needsReconnect: true }),
    ]);
    const { hook, onImported } = setup();
    // Expired accounts are not offered.
    await waitFor(() =>
      expect(hook.result.current.chooser.accounts.map((a) => a.id)).toEqual(['c1', 'c2']),
    );
    act(() => hook.result.current.open());
    expect(hook.result.current.chooser.open).toBe(true);
    expect(hook.result.current.dialog.open).toBe(false);

    act(() => hook.result.current.chooser.onChoose(connection('c2')));
    expect(hook.result.current.chooser.open).toBe(false);
    expect(hook.result.current.dialog.open).toBe(true);
    await waitFor(() => expect(onImported).toHaveBeenCalled());

    expect(requests.map((r) => r.url)).toContain('/api/microsoft/file-picker?connectionId=c2');
    expect(requests.find((r) => r.url === '/api/microsoft/file-picker/token')?.body).toEqual({
      resource: 'https://contoso-my.sharepoint.com',
      connectionId: 'c2',
    });
    expect(requests.find((r) => r.url === '/api/decks/drive-item')?.body).toEqual({
      driveId: 'b!d',
      itemId: 'i1',
      connectionId: 'c2',
      workspaceId: 'ws1',
    });
  });

  it('opens the picker straight away with a single account', async () => {
    const requests = stubApi([connection('c1')]);
    const { hook } = setup();
    act(() => hook.result.current.open());
    expect(hook.result.current.chooser.open).toBe(false);
    expect(hook.result.current.dialog.open).toBe(true);
    await waitFor(() => expect(picker.runPicker).toHaveBeenCalled());
    // One account: the API takes it (the latest) without being told.
    expect(requests.map((r) => r.url)).toContain('/api/microsoft/file-picker');
    expect(requests.map((r) => r.url)).not.toContain('/api/me/microsoft');
  });
});
