import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceUser, InstanceWorkspace } from '@slider/shared';
import { UsersTable } from './UsersTable';
import { WorkspacesTable } from './WorkspacesTable';

const api = vi.hoisted(() => ({
  workspaces: [] as InstanceWorkspace[],
  users: [] as InstanceUser[],
  queries: [] as { list: string; q: string; offset: number }[],
  blockWorkspace: vi.fn(),
  setPlan: vi.fn(),
  blockUser: vi.fn(),
}));

const mutation = (mutate: (...args: unknown[]) => void) => ({
  mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
    mutate(input);
    options?.onSuccess?.();
  },
  reset: () => {},
  isPending: false,
  error: null,
});

vi.mock('@/lib/api', () => ({
  useInstanceWorkspaces: (q: string, offset: number) => {
    api.queries.push({ list: 'workspaces', q, offset });
    return { isError: false, data: { workspaces: api.workspaces, total: api.workspaces.length } };
  },
  useInstanceUsers: (q: string, offset: number) => {
    api.queries.push({ list: 'users', q, offset });
    return { isError: false, data: { users: api.users, total: api.users.length } };
  },
  useSetWorkspaceBlocked: () => mutation(api.blockWorkspace),
  useSetWorkspacePlan: () => mutation(api.setPlan),
  useSetUserBlocked: () => mutation(api.blockUser),
}));

const workspace = (patch: Partial<InstanceWorkspace> = {}): InstanceWorkspace => ({
  id: 'w1',
  name: 'Firma',
  logoUrl: null,
  joinDomain: 'firma.de',
  createdAt: '2026-01-01T00:00:00.000Z',
  plan: 'free',
  planGranted: false,
  subscribed: false,
  memberCount: 3,
  deckCount: 2,
  storageBytes: 0,
  blockedAt: null,
  ...patch,
});

const user = (patch: Partial<InstanceUser> = {}): InstanceUser => ({
  id: 'u2',
  name: 'Anna',
  email: 'anna@firma.de',
  color: 'blue',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-02T00:00:00.000Z',
  workspaceCount: 1,
  isInstanceAdmin: false,
  blockedAt: null,
  ...patch,
});

const wrap = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => {
  api.workspaces = [workspace()];
  api.users = [user()];
  api.queries = [];
  api.blockWorkspace.mockReset();
  api.setPlan.mockReset();
  api.blockUser.mockReset();
});

describe('workspaces on the dashboard (BER-167)', () => {
  it('shows sizes, not contents, and blocks after asking', async () => {
    const notify = vi.fn();
    wrap(<WorkspacesTable plans onNotify={notify} />);
    const row = screen.getByRole('row', { name: /Firma/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['FFirma@firma.de', '3', '2', '0 B', 'Free-Plan', expect.any(String), '']);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Firma“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sperren …' }));
    const dialog = screen.getByRole('dialog', { name: '„Firma“ sperren?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sperren' }));
    expect(api.blockWorkspace).toHaveBeenCalledWith({ workspaceId: 'w1', blocked: true });
    expect(notify).toHaveBeenCalledWith('„Firma“ ist gesperrt');
  });

  it('grants Paid, takes it back, and leaves a subscription alone', async () => {
    const { unmount } = wrap(<WorkspacesTable plans onNotify={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Firma“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paid freischalten' }));
    await userEvent.click(screen.getByRole('button', { name: 'Paid freischalten' }));
    expect(api.setPlan).toHaveBeenCalledWith({ workspaceId: 'w1', plan: 'paid' });
    unmount();

    api.workspaces = [workspace({ plan: 'paid', planGranted: true })];
    const granted = wrap(<WorkspacesTable plans onNotify={vi.fn()} />);
    expect(screen.getByText('freigeschaltet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Firma“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Freischaltung beenden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Auf Free setzen' }));
    expect(api.setPlan).toHaveBeenLastCalledWith({ workspaceId: 'w1', plan: 'free' });
    granted.unmount();

    api.workspaces = [workspace({ plan: 'paid', subscribed: true })];
    wrap(<WorkspacesTable plans onNotify={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Firma“' }));
    expect(
      screen.getByRole('menuitem', { name: 'Paid freischalten' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('without different plans: no plan, no plan actions', async () => {
    wrap(<WorkspacesTable plans={false} onNotify={vi.fn()} />);
    expect(screen.queryByText('Free-Plan')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „Firma“' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Sperren …']);
  });

  it('searches once typing pauses, from the first page', async () => {
    wrap(<WorkspacesTable plans onNotify={vi.fn()} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Name oder Domain suchen' }), 'fir');
    await vi.waitFor(() =>
      expect(api.queries.at(-1)).toEqual({ list: 'workspaces', q: 'fir', offset: 0 }),
    );
  });
});

describe('accounts on the dashboard (BER-167)', () => {
  it('blocks and unblocks after asking; the instance admin has no actions', async () => {
    api.users = [
      user(),
      user({ id: 'u1', name: 'Robert', isInstanceAdmin: true }),
      user({ id: 'u3', name: 'Bert', blockedAt: '2026-01-03T00:00:00.000Z' }),
    ];
    wrap(<UsersTable userId="u1" onNotify={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aktionen für Robert' })).toBeNull();
    expect(screen.getByText('Gesperrt')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für Anna' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sperren …' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sperren' }));
    expect(api.blockUser).toHaveBeenCalledWith({ userId: 'u2', blocked: true });

    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für Bert' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Entsperren' }));
    await userEvent.click(screen.getByRole('button', { name: 'Entsperren' }));
    expect(api.blockUser).toHaveBeenLastCalledWith({ userId: 'u3', blocked: false });
  });
});
