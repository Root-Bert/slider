import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component as UsagePage } from './UsagePage';

const state = vi.hoisted(() => ({
  plan: 'free',
  lastId: null as string | null,
  usageCalls: [] as { id: string | null; refetchInterval: number | false | undefined }[],
}));

vi.mock('@/lib/api', () => ({
  queryKeys: { me: ['me'] },
  useWorkspaceUsage: (id: string | null, options: { refetchInterval?: number | false }) => {
    state.usageCalls.push({ id, refetchInterval: options.refetchInterval });
    return { isPending: false, isError: false, data: { workspaceId: id, plan: state.plan } };
  },
}));

vi.mock('@/features/auth', () => ({
  useAccount: () => ({
    user: { id: 'u1' },
    workspaces: [
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ],
  }),
}));

vi.mock('@/features/workspaces', () => ({
  pickWorkspace: (workspaces: { id: string }[], id: string | null) =>
    workspaces.find((each) => each.id === id) ?? workspaces[0] ?? null,
  readLastWorkspaceId: () => state.lastId,
  UsageOverview: ({ details }: { details: { workspaceId: string; plan: string } }) => (
    <p>
      Übersicht {details.workspaceId} {details.plan}
    </p>
  ),
}));

vi.mock('@/shell/layouts/SettingsLayout', () => ({
  SettingsLayout: ({
    children,
    toast,
  }: {
    children: ReactNode;
    toast: { text: string } | null;
  }) => (
    <main>
      {children}
      {toast && <p role="status">{toast.text}</p>}
    </main>
  ),
}));

const open = (url: string) => {
  const router = createMemoryRouter([{ path: '/nutzung', element: <UsagePage /> }], {
    initialEntries: [url],
  });
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, invalidate };
};

beforeEach(() => {
  state.plan = 'free';
  state.lastId = null;
  state.usageCalls = [];
});

afterEach(() => vi.useRealTimers());

describe('UsagePage', () => {
  it('opens ?workspace=, else the last used one, and switches between them', async () => {
    state.lastId = 'B';
    const { router } = open('/nutzung');
    expect(screen.getByText('Übersicht B free')).toBeTruthy();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Workspace' }), 'A');
    expect(screen.getByText('Übersicht A free')).toBeTruthy();
    expect(router.state.location.search).toBe('?workspace=A');
  });

  it('still opens the old ?organisation= links from mails and Stripe', () => {
    state.lastId = 'B';
    open('/nutzung?organisation=A');
    expect(screen.getByText('Übersicht A free')).toBeTruthy();
  });

  it('back from paying: thanks once, drops the flag and asks again until the plan is paid', async () => {
    vi.useFakeTimers();
    const { router, invalidate } = open('/nutzung?workspace=A&checkout=success');
    expect(screen.getByRole('status').textContent).toBe('Danke! Die Zahlung ist eingegangen.');
    expect(router.state.location.search).toBe('?workspace=A');
    expect(state.usageCalls.at(-1)?.refetchInterval).toBe(2000);

    // At most ten seconds, then the header learns the plan from `me`.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(state.usageCalls.at(-1)?.refetchInterval).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  it('stops asking as soon as the plan arrived', () => {
    state.plan = 'paid';
    open('/nutzung?workspace=A&checkout=success');
    expect(state.usageCalls.at(-1)?.refetchInterval).toBe(false);
  });
});
