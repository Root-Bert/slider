import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LoginIdentity, Passkey } from '@slider/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginsSection, PasskeysSection } from './AccountSections';

const api = vi.hoisted(() => ({
  supported: true,
  identities: { isPending: false, isError: false, data: [] as LoginIdentity[] },
  providers: [] as { id: string; loginUrl: string }[],
  passkeys: { isPending: false, isError: false, data: [] as Passkey[] },
  unlink: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  register: vi.fn(),
  /** What the dialogs' mutations report as failed. */
  error: null as Error | null,
}));

vi.mock('@/lib/api', () => ({
  useIdentities: () => api.identities,
  useAuthProviders: () => ({ data: { providers: api.providers, devLogin: false } }),
  useUnlinkIdentity: () => ({ mutate: api.unlink, isPending: false, error: api.error }),
  usePasskeys: () => api.passkeys,
  useRegisterPasskey: () => ({ mutate: api.register, isPending: false }),
  useRenamePasskey: () => ({ mutate: api.rename, isPending: false, error: api.error }),
  useDeletePasskey: () => ({ mutate: api.remove, isPending: false, error: api.error }),
}));

vi.mock('@/lib/passkeys', () => ({
  passkeysSupported: () => api.supported,
  isPasskeyCancel: () => false,
  passkeyErrorMessage: (error: Error) => error.message,
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

const passkey = (patch: Partial<Passkey> = {}): Passkey => ({
  id: 'pk1',
  name: 'MacBook',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  synced: false,
  ...patch,
});

beforeEach(() => {
  api.supported = true;
  api.identities = { isPending: false, isError: false, data: [] };
  api.providers = [];
  api.passkeys = { isPending: false, isError: false, data: [] };
  for (const fn of [api.unlink, api.rename, api.remove, api.register]) fn.mockReset();
});

describe('LoginsSection', () => {
  it('lists connected logins and offers the missing providers, dimmed', () => {
    api.identities.data = [
      {
        id: 'microsoft:1',
        provider: 'microsoft',
        email: 'anna@firma.de',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    api.providers = [
      { id: 'microsoft', loginUrl: '/api/auth/microsoft/login' },
      { id: 'google', loginUrl: '/api/auth/google/login' },
    ];
    render(<LoginsSection microsoftConnected onNotify={vi.fn()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('anna@firma.de');
    expect(within(rows[0]!).getByLabelText('Verbunden mit OneDrive & SharePoint')).toBeTruthy();
    expect(rows[1]!.textContent).toContain('Nicht verbunden');
    expect(within(rows[1]!).getByRole('button', { name: 'Verbinden' })).toBeTruthy();
    expect(rows[1]!.querySelector('[data-slot="leading"]')!.className).toContain('opacity-60');
  });

  it('unlinks a login after confirming', async () => {
    const onNotify = vi.fn();
    api.identities.data = [
      { id: 'google:1', provider: 'google', email: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    render(<LoginsSection microsoftConnected={false} onNotify={onNotify} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für Google' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Trennen' }));
    const dialog = screen.getByRole('dialog', { name: 'Google trennen?', hidden: true });
    expect(dialog.textContent).toContain('Mit diesem Google-Konto kommst du dann nicht mehr');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Trennen', hidden: true }));
    expect(api.unlink).toHaveBeenCalledWith('google:1', expect.anything());
    const { onSuccess } = api.unlink.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(onNotify).toHaveBeenCalledWith('Google getrennt');
  });
});

describe('PasskeysSection', () => {
  it('explains an empty list; an unsupported browser gets a hint and no add button', () => {
    const { unmount } = render(<PasskeysSection onNotify={vi.fn()} />);
    expect(screen.getByText(/Noch kein Passkey\./)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Passkey hinzufügen/ })).toHaveLength(2);
    unmount();

    api.supported = false;
    render(<PasskeysSection onNotify={vi.fn()} />);
    expect(screen.getByText('Dieser Browser unterstützt keine Passkeys.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Passkey hinzufügen/ })).toBeNull();
  });

  it('renames a passkey: empty names are refused, Enter saves the trimmed name', async () => {
    const onNotify = vi.fn();
    api.passkeys.data = [passkey({ synced: true })];
    render(<PasskeysSection onNotify={onNotify} />);
    expect(screen.getByRole('listitem').textContent).toContain('Synchronisiert');

    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „MacBook“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Umbenennen' }));
    const field = screen.getByRole('textbox', { name: 'Name', hidden: true });
    const save = screen.getByRole('button', { name: 'Speichern', hidden: true });

    await userEvent.clear(field);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Der Name darf nicht leer sein.')).toBeTruthy();

    await userEvent.type(field, '  iPhone {Enter}');
    expect(api.rename).toHaveBeenCalledWith({ id: 'pk1', name: 'iPhone' }, expect.anything());
    const { onSuccess } = api.rename.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(onNotify).toHaveBeenCalledWith('Name gespeichert');
  });

  it('removes a passkey after confirming', async () => {
    const onNotify = vi.fn();
    api.passkeys.data = [passkey()];
    render(<PasskeysSection onNotify={onNotify} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „MacBook“' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Entfernen' }));
    const dialog = screen.getByRole('dialog', { name: '„MacBook“ entfernen?', hidden: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entfernen', hidden: true }));
    expect(api.remove).toHaveBeenCalledWith('pk1', expect.anything());
    const { onSuccess } = api.remove.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(onNotify).toHaveBeenCalledWith('Passkey entfernt');
  });

  it.each([
    ['Entfernen', '„MacBook“ entfernen?'],
    ['Umbenennen', 'Passkey umbenennen'],
  ])(
    '%s: a failure shows in the dialog, not in a toast behind its backdrop',
    async (item, title) => {
      api.error = new Error('Nicht gefunden');
      const onNotify = vi.fn();
      api.passkeys.data = [passkey()];
      render(<PasskeysSection onNotify={onNotify} />);
      await userEvent.click(screen.getByRole('button', { name: 'Aktionen für „MacBook“' }));
      await userEvent.click(screen.getByRole('menuitem', { name: item }));
      const dialog = screen.getByRole('dialog', { name: title, hidden: true });
      expect(within(dialog).getByText('Nicht gefunden')).toBeTruthy();
      expect(onNotify).not.toHaveBeenCalled();
      api.error = null;
    },
  );
});
