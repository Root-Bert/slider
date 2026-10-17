import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@slider/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteSection, LeaveSection } from './WorkspaceSections';

const api = vi.hoisted(() => ({
  remove: vi.fn(),
  leave: vi.fn(),
  members: { isSuccess: true, data: [] as unknown[] },
}));

vi.mock('@/lib/api', () => ({
  useDeleteWorkspace: () => ({ mutate: api.remove, isPending: false }),
  useRemoveMember: () => ({ mutate: api.leave, isPending: false }),
  useMembers: () => api.members,
  useRenameWorkspace: () => ({ mutate: vi.fn(), isPending: false }),
  useWorkspaceLogo: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

beforeAll(() => {
  // happy-dom may lack the modal API; the behaviour under test doesn't depend on the top layer.
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

const workspace = (role: WorkspaceRole = 'admin'): Workspace => ({
  id: 'w1',
  name: 'Agentur Nord',
  slug: 'agentur-nord',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
  memberCount: 2,
  plan: 'free',
  usage: { members: 2, seatsUsed: 2, maxMembers: 5, decks: 0, maxDecks: 3 },
});

const member = (userId: string, name: string, role: WorkspaceRole): WorkspaceMember => ({
  userId,
  name,
  email: `${userId}@firma.de`,
  color: 'blue',
  role,
  isCreator: false,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

const button = (name: string | RegExp) => screen.getByRole('button', { name, hidden: true });
/** The section's own "Verlassen" (the closed dialog's confirm button shares the name). */
const leaveTrigger = () =>
  screen.getAllByRole('button', { name: 'Verlassen', hidden: true })[0] as HTMLButtonElement;

beforeEach(() => {
  api.remove.mockReset();
  api.leave.mockReset();
  api.members = { isSuccess: true, data: [] };
});

describe('DeleteSection', () => {
  it('deletes only after the name is typed in', async () => {
    const onNotify = vi.fn();
    render(
      <MemoryRouter>
        <DeleteSection workspace={workspace()} onNotify={onNotify} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'Organisation löschen' })).toBeTruthy();
    // The type-to-confirm field only exists while the dialog is open.
    expect(
      screen.queryByRole('textbox', { name: 'Name der Organisation', hidden: true }),
    ).toBeNull();

    await userEvent.click(button('Löschen'));
    expect(
      screen.getByRole('dialog', { name: '„Agentur Nord“ endgültig löschen?', hidden: true }),
    ).toBeTruthy();
    const confirm = button('Endgültig löschen') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const field = screen.getByRole('textbox', { name: 'Name der Organisation', hidden: true });
    await userEvent.type(field, 'Agentur');
    expect(confirm.disabled).toBe(true);
    await userEvent.type(field, ' Nord ');
    expect(confirm.disabled).toBe(false);

    await userEvent.click(confirm);
    expect(api.remove).toHaveBeenCalledOnce();
    const { onError } = api.remove.mock.calls[0]![1] as { onError: (error: Error) => void };
    onError(new Error('Nicht erlaubt'));
    expect(onNotify).toHaveBeenCalledWith('Nicht erlaubt', 'danger');
  });

  it('cancelling clears what was typed', async () => {
    render(
      <MemoryRouter>
        <DeleteSection workspace={workspace()} onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(button('Löschen'));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Name der Organisation', hidden: true }),
      'Agentur Nord',
    );
    await userEvent.click(button('Abbrechen'));
    await userEvent.click(button('Löschen'));
    const field = screen.getByRole('textbox', {
      name: 'Name der Organisation',
      hidden: true,
    }) as HTMLInputElement;
    expect(field.value).toBe('');
  });
});

describe('LeaveSection', () => {
  it('a member leaves without handing anything over', async () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'member'), member('u2', 'Ben', 'admin')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('member')} userId="me" onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(leaveTrigger());
    expect(screen.queryByRole('combobox', { hidden: true })).toBeNull();
    const dialog = screen.getByRole('dialog', { name: '„Agentur Nord“ verlassen?', hidden: true });
    expect(dialog.textContent).toContain('Zurück kommst du nur mit einer neuen Einladung.');

    const confirm = screen
      .getAllByRole('button', { name: 'Verlassen', hidden: true })
      .find((candidate) => dialog.contains(candidate))!;
    await userEvent.click(confirm);
    expect(api.leave).toHaveBeenCalledWith(
      { userId: 'me', successor: undefined },
      expect.anything(),
    );
  });

  it('the last admin picks a successor (not a viewer) and hands over in the same step', async () => {
    api.members = {
      isSuccess: true,
      data: [
        member('me', 'Anna', 'admin'),
        member('u2', 'Ben', 'member'),
        member('u3', 'Cleo', 'viewer'),
        member('u4', 'Dora', 'reviewer'),
      ],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('admin')} userId="me" onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    await userEvent.click(leaveTrigger());
    const select = screen.getByRole('combobox', { hidden: true }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Ben · Mitglied',
      'Dora · Reviewer',
    ]);
    expect(screen.getByText(/Ben wird Admin/)).toBeTruthy();

    await userEvent.selectOptions(select, 'u4');
    expect(screen.getByText(/Dora wird Admin/)).toBeTruthy();
    await userEvent.click(button('Übergeben & verlassen'));
    expect(api.leave).toHaveBeenCalledWith({ userId: 'me', successor: 'u4' }, expect.anything());
  });

  it('alone in it, leaving is off – only deleting is left', () => {
    api.members = { isSuccess: true, data: [member('me', 'Anna', 'admin')] };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('admin')} userId="me" onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(true);
    expect(screen.getByText(/Du bist allein in dieser Organisation/)).toBeTruthy();
  });

  it('with only viewers left, the last admin is told to give one another role – not "allein"', () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u3', 'Cleo', 'viewer')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('admin')} userId="me" onNotify={vi.fn()} />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(true);
    expect(screen.queryByText(/Du bist allein/)).toBeNull();
    expect(screen.getByText(/nur Betrachter.*eine andere Rolle/)).toBeTruthy();
  });
});
