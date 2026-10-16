import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workspace, WorkspaceMember } from '@slider/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { MembersSection } from './MembersSection';

// The real mutation hooks: what is tested here is how TanStack Query calls back per `mutate`.

beforeAll(() => {
  const proto = HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  }
});

const workspace = {
  id: 'w1',
  name: 'Agentur Nord',
  role: 'admin',
  usage: { members: 3, seatsUsed: 3, maxMembers: null, decks: 0, maxDecks: null },
} as Workspace;

const member = (userId: string, name: string, role: WorkspaceMember['role']): WorkspaceMember => ({
  userId,
  name,
  email: `${userId}@firma.de`,
  color: 'blue',
  role,
  isCreator: false,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path.endsWith('/members')
      ? [
          member('rob', 'Robert', 'admin'),
          member('anna', 'Anna', 'member'),
          member('ben', 'Ben', 'member'),
        ]
      : [],
  );
  const onNotify = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MembersSection workspace={workspace} userId="rob" onNotify={onNotify} />
    </QueryClientProvider>,
  );
  return { onNotify, client };
}

describe('MembersSection', () => {
  it('a failed role change still says so when another one was made meanwhile', async () => {
    let failFirst: (error: Error) => void = () => {};
    vi.spyOn(api, 'patch')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const { onNotify, client } = setup();
    await userEvent.selectOptions(await screen.findByLabelText('Rolle von Anna'), 'reviewer');
    await userEvent.selectOptions(screen.getByLabelText('Rolle von Ben'), 'viewer');
    // Each row waits for its own change.
    expect((screen.getByLabelText('Rolle von Anna') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Rolle von Ben') as HTMLSelectElement).disabled).toBe(true);

    await act(async () => failFirst(new Error('Keine Verbindung zum Server.')));
    expect(onNotify).toHaveBeenCalledWith('Keine Verbindung zum Server.', 'danger');
    client.clear();
  });

  it('a failed removal shows in the dialog, not in a toast behind its backdrop', async () => {
    vi.spyOn(api, 'delete').mockRejectedValue(new Error('Keine Verbindung zum Server.'));
    const { onNotify, client } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Anna entfernen' }));
    const dialog = screen.getByRole('dialog', { name: 'Anna entfernen?', hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entfernen', hidden: true }));
    expect(await within(dialog).findByText('Keine Verbindung zum Server.')).toBeTruthy();
    expect(onNotify).not.toHaveBeenCalled();

    // Opened again later: no stale error from the last attempt.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Ben entfernen' }));
    const again = screen.getByRole('dialog', { name: 'Ben entfernen?', hidden: true });
    expect(within(again).queryByText('Keine Verbindung zum Server.')).toBeNull();
    client.clear();
  });
});
