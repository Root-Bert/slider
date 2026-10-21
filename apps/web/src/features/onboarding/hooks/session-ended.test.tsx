import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type * as ApiClientModule from '@/lib/api-client';
import { setSessionErrorHandler } from '@/lib/api';
import { useDeckUpload } from './useDeckUpload';
import { useOneDrivePicker } from './useOneDrivePicker';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    uploadWithProgress: vi.fn(() =>
      Promise.reject(new actual.ApiError(401, 'unauthorized', 'Bitte melde dich an.')),
    ),
  };
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onSessionError = vi.fn();
  setSessionErrorHandler(queryClient, onSessionError);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/neu']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { wrapper, onSessionError };
}

const unauthorized = expect.objectContaining({ status: 401, code: 'unauthorized' });

describe('/neu – session ended during a call outside React Query', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a 401 on the upload goes to the session handler (login), not only the inline error', async () => {
    const { wrapper, onSessionError } = setup();
    const hook = renderHook(() => useDeckUpload('ws1', vi.fn()), { wrapper });
    act(() => hook.result.current.start(new File(['x'], 'deck.pptx')));
    await waitFor(() => expect(hook.result.current.state.status).toBe('error'));
    expect(onSessionError).toHaveBeenCalledWith(unauthorized);
    expect(onSessionError.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
  });

  it('a 401 on the OneDrive picker session does too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'unauthorized', message: 'Bitte melde dich an.' } }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const { wrapper, onSessionError } = setup();
    const hook = renderHook(() => useOneDrivePicker('ws1', vi.fn()), { wrapper });
    hook.result.current.dialog.frameRef.current = document.createElement('iframe');
    act(() => hook.result.current.open());
    await waitFor(() => expect(hook.result.current.error).toBe('Bitte melde dich an.'));
    expect(onSessionError).toHaveBeenCalledWith(unauthorized);
  });
});
