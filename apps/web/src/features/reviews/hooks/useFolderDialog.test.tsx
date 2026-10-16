import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeckFolder } from '@slider/shared';
import { useFolderDialog } from './useFolderDialog';

const conflict = () =>
  new Response(JSON.stringify({ error: { code: 'conflict', message: 'Gibt es schon.' } }), {
    status: 409,
  });

function setup() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => conflict()),
  );
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFolderDialog('w1'), { wrapper });
}

describe('useFolderDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a failed create, cancelled, does not show its error when the dialog opens again', async () => {
    const { result } = setup();
    act(() => result.current.openCreate());
    act(() => result.current.submit('Kunden'));
    await waitFor(() => expect(result.current.error).toBe('Gibt es schon.'));
    expect(result.current.state).toEqual({ mode: 'create' });

    act(() => result.current.close());
    act(() => result.current.openCreate());
    expect(result.current.error).toBeUndefined();
  });

  it('a failed rename does not show under another folder’s rename', async () => {
    const { result } = setup();
    act(() => result.current.openRename({ id: 'f1', name: 'A' } as DeckFolder));
    act(() => result.current.submit('B'));
    await waitFor(() => expect(result.current.error).toBe('Gibt es schon.'));

    act(() => result.current.openRename({ id: 'f2', name: 'C' } as DeckFolder));
    expect(result.current.error).toBeUndefined();
  });
});
