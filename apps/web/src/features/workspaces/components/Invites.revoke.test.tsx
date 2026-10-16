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
  it('two quick revokes keep their own spinner and their own error', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      invite('a', 'anna@firma.de'),
      invite('b', 'ben@firma.de'),
    ]);
    let failFirst: (error: Error) => void = () => {};
    vi.spyOn(api, 'delete')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const onNotify = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InviteList workspace={workspace} onNotify={onNotify} />
      </QueryClientProvider>,
    );
    const row = async (email: string) =>
      (await screen.findAllByRole('listitem')).find((item) => item.textContent?.includes(email))!;
    const revokeButton = async (email: string) =>
      within(await row(email)).queryByRole('button', { name: 'Einladung zurückziehen' });

    await userEvent.click((await revokeButton('anna@firma.de'))!);
    await userEvent.click((await revokeButton('ben@firma.de'))!);
    // The first one is still running: its spinner stays, no button to send it twice.
    expect(await revokeButton('anna@firma.de')).toBeNull();

    await act(async () => failFirst(new Error('Keine Verbindung zum Server.')));
    expect(onNotify).toHaveBeenCalledWith('Keine Verbindung zum Server.', 'danger');
    client.clear();
  });
});
