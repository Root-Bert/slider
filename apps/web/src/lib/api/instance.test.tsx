import type { InstanceWorkspace } from '@slider/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api-client';
import { useSetWorkspaceBlocked } from './instance';

afterEach(() => vi.restoreAllMocks());

const workspace = (id: string, blockedAt: string | null = null) =>
  ({ id, name: id, blockedAt }) as InstanceWorkspace;

describe('changes on the instance dashboard (BER-167)', () => {
  it('swaps the changed row on every cached page and reloads only the overview', async () => {
    const blocked = workspace('w1', '2026-10-21T00:00:00.000Z');
    vi.spyOn(api, 'put').mockResolvedValue(blocked);
    const client = new QueryClient();
    const firstPage = ['instance', 'workspaces', '', 0];
    const search = ['instance', 'workspaces', 'w', 0];
    client.setQueryData(firstPage, { workspaces: [workspace('w1'), workspace('w2')], total: 2 });
    client.setQueryData(search, { workspaces: [workspace('w1')], total: 1 });
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetWorkspaceBlocked(), { wrapper });
    await act(() => result.current.mutateAsync({ workspaceId: 'w1', blocked: true }));
    expect(client.getQueryData(firstPage)).toEqual({
      workspaces: [blocked, workspace('w2')],
      total: 2,
    });
    expect(client.getQueryData(search)).toEqual({ workspaces: [blocked], total: 1 });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['instance', 'overview'] });
    client.clear();
  });
});
