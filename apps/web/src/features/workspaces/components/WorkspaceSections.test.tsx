import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@slider/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingFixture } from '@/test/workspace';
import { DeleteSection, DomainSection, LeaveSection } from './WorkspaceSections';

const api = vi.hoisted(() => ({
  remove: vi.fn(),
  removeError: null as Error | null,
  leave: vi.fn(),
  leaveError: null as Error | null,
  setDomain: vi.fn(),
  members: { isSuccess: true, data: [] as unknown[] },
  departure: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useDeleteWorkspace: () => ({
    mutate: api.remove,
    isPending: false,
    error: api.removeError,
    reset: vi.fn(),
  }),
  useRemoveMember: () => ({
    mutate: api.leave,
    isPending: false,
    error: api.leaveError,
    reset: vi.fn(),
  }),
  useMembers: () => api.members,
  useMemberDeparture: api.departure,
  useRenameWorkspace: () => ({ mutate: vi.fn(), isPending: false }),
  useSetWorkspaceDomain: () => ({ mutate: api.setDomain, isPending: false }),
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

const workspace = (role: WorkspaceRole = 'admin', patch: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  name: 'Agentur Nord',
  slug: 'agentur-nord',
  logoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role,
  memberCount: 2,
  plan: 'free',
  usage: {
    members: 2,
    seatsUsed: 2,
    maxMembers: 5,
    decks: 0,
    maxDecks: 3,
    storageBytes: 0,
    maxStorageBytes: null,
  },
  billing: billingFixture(),
  locked: false,
  joinDomain: null,
  audiencePending: false,
  ...patch,
});

/** Paid with a running subscription, paid for by `isOwner` (the viewer) or Ada. */
const paid = (isOwner: boolean, role: WorkspaceRole = 'admin') =>
  workspace(role, {
    plan: 'paid',
    billing: billingFixture({
      enabled: true,
      status: 'active',
      isOwner,
      owner: isOwner ? { id: 'me', name: 'Anna' } : { id: 'u9', name: 'Ada' },
    }),
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
  api.removeError = null;
  api.leave.mockReset();
  api.leaveError = null;
  api.setDomain.mockReset();
  api.members = { isSuccess: true, data: [] };
  api.departure.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      heir: { userId: 'u2', name: 'Ben' },
      deleted: [{ id: 'd1', title: 'Q4 aus SharePoint' }],
      transferred: [{ id: 'd2', title: 'Workshop' }],
    },
  });
});

describe('DomainSection', () => {
  const section = (ws: Workspace, email = 'anna@agentur-nord.de', enabled = true) =>
    render(<DomainSection workspace={ws} email={email} enabled={enabled} onNotify={vi.fn()} />);

  it('admins open the organisation to their own domain', async () => {
    section(workspace());
    const toggle = screen.getByRole('switch', { name: /Alle mit @agentur-nord\.de/ });
    await userEvent.click(toggle);
    expect(api.setDomain).toHaveBeenCalledWith(true, expect.anything());
  });

  it('opened, the switch is on and turns it off', async () => {
    section({ ...workspace(), joinDomain: 'agentur-nord.de' });
    const toggle = screen.getByRole('switch', { name: /Alle mit @agentur-nord\.de/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    expect(api.setDomain).toHaveBeenCalledWith(false, expect.anything());
  });

  it('hidden for members, admins with a mail provider address and with SIGNUP=invite', () => {
    section(workspace('member'));
    section(workspace(), 'anna@gmail.com');
    section({ ...workspace(), joinDomain: 'agentur-nord.de' }, 'anna@agentur-nord.de', false);
    expect(screen.queryByRole('region', { name: 'Beitritt per Domain' })).toBeNull();
  });
});

describe('DeleteSection', () => {
  it('deletes only after the name is typed in', async () => {
    render(
      <MemoryRouter>
        <DeleteSection workspace={workspace()} />
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
    // A free organisation has no subscription to mention.
    expect(screen.queryByText(/Abo/)).toBeNull();
  });

  it('shows a refusal inside the dialog, not behind its backdrop', async () => {
    api.removeError = new Error('Nicht erlaubt');
    render(
      <MemoryRouter>
        <DeleteSection workspace={workspace()} />
      </MemoryRouter>,
    );
    await userEvent.click(button('Löschen'));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.textContent).toContain('Nicht erlaubt');
  });

  it('the paying admin is told the subscription ends with it', async () => {
    render(
      <MemoryRouter>
        <DeleteSection workspace={paid(true)} />
      </MemoryRouter>,
    );
    await userEvent.click(button('Löschen'));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.textContent).toContain('Das laufende Abo wird dabei gekündigt.');
  });

  it('other admins of a paid organisation cannot delete it and see who can', () => {
    render(
      <MemoryRouter>
        <DeleteSection workspace={paid(false)} />
      </MemoryRouter>,
    );
    const trigger = button('Löschen');
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    // The reason is tied to the disabled button.
    expect(document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /Solange das Abo läuft, kann nur Ada die Organisation löschen/,
    );
  });

  it('cancelling clears what was typed', async () => {
    render(
      <MemoryRouter>
        <DeleteSection workspace={workspace()} />
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
        <LeaveSection workspace={workspace('member')} userId="me" />
      </MemoryRouter>,
    );
    await userEvent.click(leaveTrigger());
    expect(screen.queryByRole('combobox', { hidden: true })).toBeNull();
    const dialog = screen.getByRole('dialog', { name: '„Agentur Nord“ verlassen?', hidden: true });
    expect(dialog.textContent).toContain('Zurück kommst du nur mit einer neuen Einladung.');
    // What becomes of their reviews (BER-165).
    expect(api.departure).toHaveBeenCalledWith('w1', 'me', undefined);
    expect(dialog.textContent).toContain('Diese verknüpften Reviews werden mit allen Kommentaren gelöscht');
    expect(dialog.textContent).toContain('Q4 aus SharePoint');
    expect(dialog.textContent).toContain('Diese hochgeladenen Reviews gehen an Ben:');
    expect(dialog.textContent).toContain('Workshop');

    const confirm = screen
      .getAllByRole('button', { name: 'Verlassen', hidden: true })
      .find((candidate) => dialog.contains(candidate))!;
    await userEvent.click(confirm);
    expect(api.leave).toHaveBeenCalledWith(
      { userId: 'me', successor: undefined },
      expect.anything(),
    );
  });

  it('the last admin picks a successor (viewers only as the last resort) and hands over in the same step', async () => {
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
        <LeaveSection workspace={workspace('admin')} userId="me" />
      </MemoryRouter>,
    );
    await userEvent.click(leaveTrigger());
    const select = screen.getByRole('combobox', { hidden: true }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Ben | Mitglied',
      'Dora | Reviewer',
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
        <LeaveSection workspace={workspace('admin')} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(true);
    expect(screen.getByText(/Du bist allein in dieser Organisation/)).toBeTruthy();
  });

  it('whoever pays for a running subscription hands over paying first', () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u2', 'Ben', 'admin')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={paid(true)} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(true);
    const reason = document.getElementById(leaveTrigger().getAttribute('aria-describedby')!);
    expect(reason?.textContent).toMatch(/Du bezahlst für diese Organisation\. Übergib zuerst/);
    expect(screen.getByRole('link', { name: '„Nutzung“' }).getAttribute('href')).toBe(
      '/nutzung?organisation=w1',
    );
  });

  it('paying with no other admin: someone becomes admin first', () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u2', 'Ben', 'member')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={paid(true)} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(true);
    expect(
      screen.getByText(/Mach zuerst jemanden zum Admin und übergib dann die Zahlung/),
    ).toBeTruthy();
  });

  it('other admins of a paid organisation leave as usual', () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u9', 'Ada', 'admin')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={paid(false)} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(false);
  });

  it('once the subscription is cancelled to the period end, its payer may leave', () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u2', 'Ben', 'admin')],
    };
    const cancelled = paid(true);
    cancelled.billing = { ...cancelled.billing, endsAt: '2026-11-30T00:00:00.000Z' };
    render(
      <MemoryRouter>
        <LeaveSection workspace={cancelled} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(false);
  });

  it('shows a refusal inside the dialog', async () => {
    api.leaveError = new Error('Du bezahlst für die Organisation.');
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'member'), member('u2', 'Ben', 'admin')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('member')} userId="me" />
      </MemoryRouter>,
    );
    await userEvent.click(leaveTrigger());
    const dialog = screen.getByRole('dialog', { name: '„Agentur Nord“ verlassen?', hidden: true });
    expect(dialog.textContent).toContain('Du bezahlst für die Organisation.');
  });

  it('with only viewers left, the last admin hands over to one of them', async () => {
    api.members = {
      isSuccess: true,
      data: [member('me', 'Anna', 'admin'), member('u3', 'Cleo', 'viewer')],
    };
    render(
      <MemoryRouter>
        <LeaveSection workspace={workspace('admin')} userId="me" />
      </MemoryRouter>,
    );
    expect(leaveTrigger().disabled).toBe(false);
    expect(screen.queryByText(/Du bist allein/)).toBeNull();
    await userEvent.click(leaveTrigger());
    const select = screen.getByRole('combobox', { hidden: true }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Cleo | Betrachter']);
    await userEvent.click(button('Übergeben & verlassen'));
    expect(api.leave).toHaveBeenCalledWith({ userId: 'me', successor: 'u3' }, expect.anything());
  });
});
