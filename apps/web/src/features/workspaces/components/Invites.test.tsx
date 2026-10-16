import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreatedWorkspaceInvite, Workspace, WorkspaceInvite } from '@slider/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteForm, InviteList } from './Invites';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  createPending: false,
  createVariables: {} as { email?: string },
  invites: { isPending: false, isError: false, isSuccess: true, data: [] as unknown[] },
}));

vi.mock('@/lib/api', () => ({
  useCreateWorkspaceInvite: () => ({
    mutate: api.create,
    isPending: api.createPending,
    variables: api.createVariables,
  }),
  useRevokeWorkspaceInvite: () => ({ mutate: api.revoke, isPending: false, variables: undefined }),
  useWorkspaceInvites: () => api.invites,
}));

const DAY = 24 * 60 * 60 * 1000;

function makeWorkspace(usage: Partial<Workspace['usage']> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Agentur Nord',
    slug: 'agentur-nord',
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'admin',
    memberCount: 2,
    plan: 'free',
    usage: { members: 2, seatsUsed: 2, maxMembers: 5, decks: 0, maxDecks: 3, ...usage },
  };
}

function makeInvite(patch: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'i1',
    workspaceId: 'w1',
    email: null,
    role: 'member',
    state: 'valid',
    createdBy: { id: 'u1', name: 'Rob' },
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 3 * DAY + 60_000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    useCount: 0,
    deck: null,
    ...patch,
  };
}

const created = (patch: Partial<WorkspaceInvite> = {}): CreatedWorkspaceInvite => ({
  invite: makeInvite(patch),
  url: 'https://slider.example/join/abcdefghijklmnop',
  emailSent: false,
});

beforeEach(() => {
  api.create.mockReset();
  api.revoke.mockReset();
  api.createPending = false;
  api.createVariables = {};
  api.invites = { isPending: false, isError: false, isSuccess: true, data: [] };
});

describe('InviteForm', () => {
  it('shows the free seats and validates the address before inviting', async () => {
    render(<InviteForm workspace={makeWorkspace()} onNotify={vi.fn()} />);
    expect(screen.getByText('Noch 3 Plätze frei.')).toBeTruthy();

    const email = screen.getByRole('textbox', { name: 'E-Mail-Adresse' });
    await userEvent.type(email, 'kein-mail');
    await userEvent.click(screen.getByRole('button', { name: 'Einladen' }));
    expect(screen.getByText('Gib eine gültige E-Mail-Adresse ein.')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();

    await userEvent.clear(email);
    await userEvent.type(email, ' anna@firma.de {Enter}');
    expect(api.create).toHaveBeenCalledWith(
      { email: 'anna@firma.de', role: 'member' },
      expect.anything(),
    );
  });

  it('reports a sent mail as a toast and clears the field', async () => {
    const onNotify = vi.fn();
    render(<InviteForm workspace={makeWorkspace()} onNotify={onNotify} />);
    const email = screen.getByRole('textbox', { name: 'E-Mail-Adresse' });
    await userEvent.type(email, 'anna@firma.de{Enter}');
    const { onSuccess } = api.create.mock.calls[0]![1] as {
      onSuccess: (result: CreatedWorkspaceInvite) => void;
    };
    act(() => onSuccess({ ...created({ email: 'anna@firma.de' }), emailSent: true }));
    expect(onNotify).toHaveBeenCalledWith('Einladung an anna@firma.de verschickt');
    expect((email as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('textbox', { name: 'Einladungslink' })).toBeNull();
  });

  it('shows a created link once, with copy field and a dismiss button', async () => {
    render(<InviteForm workspace={makeWorkspace()} onNotify={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(api.create).toHaveBeenCalledWith({ role: 'member' }, expect.anything());
    const { onSuccess } = api.create.mock.calls[0]![1] as {
      onSuccess: (result: CreatedWorkspaceInvite) => void;
    };
    act(() => onSuccess(created()));

    expect(screen.getByText(/Einladungslink als Mitglied erstellt\./)).toBeTruthy();
    const link = screen.getByRole('textbox', { name: 'Einladungslink' }) as HTMLInputElement;
    expect(link.value).toBe('https://slider.example/join/abcdefghijklmnop');
    expect(link.readOnly).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('textbox', { name: 'Einladungslink' })).toBeNull();
  });

  it('locks e-mail invites when every seat is taken, but still offers a link', () => {
    render(
      <InviteForm workspace={makeWorkspace({ seatsUsed: 5, members: 5 })} onNotify={vi.fn()} />,
    );
    expect(screen.getByText(/Alle 5 Plätze sind belegt/).textContent).toContain(
      'Entferne ein Mitglied oder ziehe eine Einladung zurück',
    );
    expect(
      (screen.getByRole('textbox', { name: 'E-Mail-Adresse' }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Einladen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('has no seats line without a member limit', () => {
    render(<InviteForm workspace={makeWorkspace({ maxMembers: null })} onNotify={vi.fn()} />);
    expect(screen.queryByText(/Plätze/)).toBeNull();
  });
});

describe('InviteList', () => {
  it('renders nothing without invitations', () => {
    const { container } = render(<InviteList workspace={makeWorkspace()} onNotify={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists invitations; only open ones can be revoked', async () => {
    api.invites = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [
        makeInvite({ id: 'open', email: 'anna@firma.de', role: 'viewer' }),
        makeInvite({ id: 'used', state: 'used', useCount: 2 }),
      ],
    };
    const onNotify = vi.fn();
    render(<InviteList workspace={makeWorkspace()} onNotify={onNotify} />);
    expect(screen.getByRole('heading', { name: 'Einladungen' })).toBeTruthy();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const open = rows.find((row) => row.textContent?.includes('anna@firma.de'))!;
    expect(open.textContent).toContain('von Rob · noch 3 Tage gültig');
    const used = rows.find((row) => row !== open)!;
    expect(used.textContent).toContain('Einladungslink');
    expect(used.textContent).toContain('2× verwendet');
    expect(within(used).queryByRole('button', { name: 'Einladung zurückziehen' })).toBeNull();

    await userEvent.click(within(open).getByRole('button', { name: 'Einladung zurückziehen' }));
    expect(api.revoke).toHaveBeenCalledWith('open', expect.anything());
    const { onSuccess } = api.revoke.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(onNotify).toHaveBeenCalledWith('Einladung zurückgezogen');
  });

  it('shows a failed list as an error line', () => {
    api.invites = {
      isPending: false,
      isError: true,
      isSuccess: false,
      data: [],
      error: new Error('Server weg'),
    } as typeof api.invites;
    render(<InviteList workspace={makeWorkspace()} onNotify={vi.fn()} />);
    expect(screen.getByText('Server weg').className).toContain('text-danger');
  });
});
