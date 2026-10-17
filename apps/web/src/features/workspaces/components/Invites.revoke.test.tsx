import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workspace, WorkspaceInvite } from '@slider/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { InviteList } from './Invites';

// The real mutation hooks: what is tested here is how TanStack Query calls back per `mutate`.

const workspace = {
  id: 'w1',
  name: 'Agentur Nord',
  role: 'admin',
  usage: { members: 2, seatsUsed: 2, maxMembers: 5, decks: 0, maxDecks: 3 },
} as Workspace;

const invite = (id: string, email: string): WorkspaceInvite => ({
  id,
  workspaceId: 'w1',
  email,
  role: 'member',
  state: 'valid',
  createdBy: { id: 'u1', name: 'Rob' },
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  acceptedAt: null,
  revokedAt: null,
  useCount: 0,
  deck: null,
});

afterEach(() => vi.restoreAllMocks());

describe('InviteList revoking', () => {
  it('asks first, shows a failure in the dialog and keeps focus on the row', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      invite('a', 'anna@firma.de'),
      invite('b', 'ben@firma.de'),
    ]);
    let failFirst: (error: Error) => void = () => {};
    const remove = vi.spyOn(api, 'delete').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    const onNotify = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InviteList workspace={workspace} onNotify={onNotify} />
      </QueryClientProvider>,
    );
    const trash = await screen.findByRole('button', {
      name: 'Einladung an anna@firma.de zurückziehen',
    });
    expect(
      screen.getByRole('button', { name: 'Einladung an ben@firma.de zurückziehen' }),
    ).toBeTruthy();

    await userEvent.click(trash);
    expect(remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurückziehen' }));
    expect(remove).toHaveBeenCalledOnce();
    // The row's button stays in place while the request runs.
    expect(trash.isConnected).toBe(true);

    await act(async () => failFirst(new Error('Keine Verbindung zum Server.')));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Keine Verbindung zum Server.',
    );
    expect(onNotify).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trash);
    client.clear();
  });
});
