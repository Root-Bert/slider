import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckAccess, WorkspaceMember } from '@slider/shared';
import { makeDeck } from '../lib/deck-fixture';
import { DeckAccessDialog } from './DeckAccessDialog';

const member = (overrides: Partial<WorkspaceMember>): WorkspaceMember => ({
  userId: 'u?',
  name: '?',
  email: '?@example.com',
  color: 'blue',
  role: 'member',
  isCreator: false,
  joinedAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
});

// The fixture deck's owner is u1 (Robert).
const MEMBERS: WorkspaceMember[] = [
  member({ userId: 'u2', name: 'Anna Admin', email: 'anna@example.com', role: 'admin' }),
  member({ userId: 'u1', name: 'Robert Hofmann', email: 'robert@example.com' }),
  member({ userId: 'u3', name: 'Carolin Klein', email: 'carolin@example.com' }),
  member({ userId: 'u4', name: 'Neven Berg', email: 'neven@example.com', role: 'reviewer' }),
];

const query = <T,>(data: T | undefined, error: Error | null = null) => ({
  data,
  error,
  isPending: data === undefined && error === null,
});

const api = vi.hoisted(() => ({
  access: undefined as unknown,
  members: undefined as unknown,
  mutate: vi.fn(),
  pending: false,
  error: null as Error | null,
}));

vi.mock('@/lib/api', () => ({
  useDeckAccess: () => api.access,
  useMembers: () => api.members,
  useUpdateDeckAccess: () => ({ mutate: api.mutate, isPending: api.pending, error: api.error }),
}));
vi.mock('@/features/auth', () => ({
  useAccount: () => ({
    user: { id: 'u1' },
    workspaces: [{ id: 'w1', name: 'Acme' }],
  }),
}));

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

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name, hidden: true });
const radio = (name: RegExp) => screen.getByRole('radio', { name, hidden: true });
const button = (name: string) => screen.getByRole('button', { name, hidden: true });

function setup() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<DeckAccessDialog deck={makeDeck()} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

/** What `mutate` was last called with. */
const sent = () => api.mutate.mock.calls.at(-1)?.[0] as DeckAccess;

describe('DeckAccessDialog', () => {
  beforeEach(() => {
    api.access = query<DeckAccess>({ restricted: false, userIds: [] });
    api.members = query(MEMBERS);
    api.mutate.mockReset();
    api.pending = false;
    api.error = null;
  });

  it('open to everyone: says so, no member list', () => {
    setup();
    expect(
      screen.getByRole('dialog', { name: 'Zugriff auf „Q4 Strategie“', hidden: true }),
    ).toBeTruthy();
    expect((radio(/Alle in Acme/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('checkbox', { hidden: true })).toBeNull();
  });

  it('restricting: owner and admins stay ticked and locked, others can be picked; saves the list', async () => {
    const { onSaved } = setup();
    await userEvent.click(radio(/Nur ausgewählte Personen/));

    const owner = checkbox(/Robert Hofmann/) as HTMLInputElement;
    const admin = checkbox(/Anna Admin/) as HTMLInputElement;
    for (const locked of [owner, admin]) {
      expect(locked.checked).toBe(true);
      expect(locked.disabled).toBe(true);
    }
    expect(screen.getAllByText('hat immer Zugriff')).toHaveLength(2);
    // The owner is listed first, then the admins.
    const names = screen
      .getAllByRole('checkbox', { hidden: true })
      .map((box) => box.closest('label')?.textContent ?? '');
    expect(names[0]).toContain('Robert Hofmann');
    expect(names[1]).toContain('Anna Admin');

    const carolin = checkbox(/Carolin Klein/) as HTMLInputElement;
    expect(carolin.checked).toBe(false);
    await userEvent.click(carolin);
    expect(carolin.checked).toBe(true);
    expect(screen.getByText('1 Person ausgewählt')).toBeTruthy();

    await userEvent.click(button('Speichern'));
    expect(sent()).toEqual({ restricted: true, userIds: ['u3'] });
    const options = api.mutate.mock.calls[0]![1] as { onSuccess: (access: DeckAccess) => void };
    options.onSuccess({ restricted: true, userIds: ['u3'] });
    expect(onSaved).toHaveBeenCalledWith(
      { restricted: true, userIds: ['u3'] },
      { restricted: false, userIds: [] },
    );
  });

  it('starts from the saved list and drops people who left', async () => {
    api.access = query<DeckAccess>({ restricted: true, userIds: ['u4', 'gone'] });
    setup();
    expect((radio(/Nur ausgewählte Personen/) as HTMLInputElement).checked).toBe(true);
    expect((checkbox(/Neven Berg/) as HTMLInputElement).checked).toBe(true);
    expect((checkbox(/Carolin Klein/) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(button('Speichern'));
    expect(sent()).toEqual({ restricted: true, userIds: ['u4'] });
  });

  it("keeps an admin's own grant from before they became admin", async () => {
    api.access = query<DeckAccess>({ restricted: true, userIds: ['u2', 'u4'] });
    setup();
    await userEvent.click(button('Speichern'));
    expect(sent()).toEqual({ restricted: true, userIds: ['u2', 'u4'] });
  });

  it('focuses the ticked answer, or the search when the review is already restricted', async () => {
    setup();
    expect(document.activeElement).toBe(radio(/Alle in Acme/));
    // Picking "Nur ausgewählte Personen" leaves the focus there (no jump while arrowing).
    await userEvent.click(radio(/Nur ausgewählte Personen/));
    expect(document.activeElement).toBe(radio(/Nur ausgewählte Personen/));
    cleanup();

    api.access = query<DeckAccess>({ restricted: true, userIds: [] });
    setup();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Personen suchen', hidden: true }),
    );
  });

  it('opening it up again sends restricted: false', async () => {
    api.access = query<DeckAccess>({ restricted: true, userIds: ['u4'] });
    setup();
    await userEvent.click(radio(/Alle in Acme/));
    await userEvent.click(button('Speichern'));
    expect(sent().restricted).toBe(false);
  });

  it('searches by name and e-mail', async () => {
    setup();
    await userEvent.click(radio(/Nur ausgewählte Personen/));
    const search = screen.getByRole('searchbox', { name: 'Personen suchen', hidden: true });
    await userEvent.type(search, 'neven@');
    expect(screen.getAllByRole('checkbox', { hidden: true })).toHaveLength(1);
    expect(checkbox(/Neven Berg/)).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, 'xyz');
    expect(screen.getByText('Niemand gefunden')).toBeTruthy();
  });

  it('shows loading, load errors and save errors inside the dialog', async () => {
    api.access = query<DeckAccess>(undefined);
    const { unmount } = render(
      <DeckAccessDialog deck={makeDeck()} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.queryByRole('radio', { hidden: true })).toBeNull();
    unmount();

    api.access = query<DeckAccess>(undefined, new Error('Kein Zugriff'));
    const second = render(
      <DeckAccessDialog deck={makeDeck()} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('Kein Zugriff');
    second.unmount();

    api.access = query<DeckAccess>({ restricted: false, userIds: [] });
    api.error = new Error('Speichern ging nicht');
    setup();
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('Speichern ging nicht');
  });

  it('"Abbrechen" closes without saving', async () => {
    const { onClose } = setup();
    await userEvent.click(button('Abbrechen'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.mutate).not.toHaveBeenCalled();
  });
});
