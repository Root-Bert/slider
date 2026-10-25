import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GoogleConnection, MicrosoftConnection, NextcloudConnection } from '@slider/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageSection } from './StorageSection';

const api = vi.hoisted(() => ({
  providers: [] as { id: string; loginUrl: string }[],
  googleDrive: false,
  microsoft: { isPending: false, error: null as Error | null, data: [] as MicrosoftConnection[] },
  nextcloud: { isPending: false, error: null as Error | null, data: [] as NextcloudConnection[] },
  google: { isPending: false, error: null as Error | null, data: [] as GoogleConnection[] },
  disconnectMicrosoft: vi.fn(),
  disconnectGoogle: vi.fn(),
  disconnectNextcloud: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useAuthProviders: () => ({
    data: { providers: api.providers, devLogin: false, googleDrive: api.googleDrive },
  }),
  useMicrosoftConnections: () => api.microsoft,
  useNextcloudConnections: () => api.nextcloud,
  useGoogleConnections: () => api.google,
  googleDriveConnectUrl: (returnTo: string, id?: string) =>
    `/api/auth/google/drive?returnTo=${encodeURIComponent(returnTo)}${id ? `&connection=${id}` : ''}`,
  useDisconnectGoogle: () => ({ mutate: api.disconnectGoogle, isPending: false, error: null }),
  useDisconnectMicrosoft: () => ({
    mutate: api.disconnectMicrosoft,
    isPending: false,
    error: null,
  }),
  useDisconnectNextcloud: () => ({
    mutate: api.disconnectNextcloud,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/features/nextcloud', () => ({
  nextcloudHost: (server: string) => new URL(server).host,
  NextcloudConnectForm: ({ initialServer }: { initialServer: string }) => (
    <form aria-label="Nextcloud-Formular" data-server={initialServer} />
  ),
}));

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

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

const microsoft = (patch: Partial<MicrosoftConnection> = {}): MicrosoftConnection => ({
  id: 'c1',
  account: 'anna@firma.de',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  deckCount: 0,
  needsReconnect: false,
  ...patch,
});

const nextcloud = (patch: Partial<NextcloudConnection> = {}): NextcloudConnection =>
  ({
    id: 'n1',
    server: 'https://cloud.firma.de',
    account: 'anna',
    deckCount: 0,
    needsReconnect: false,
    ...patch,
  }) as NextcloudConnection;

const MICROSOFT_PROVIDER = { id: 'microsoft', loginUrl: '/api/auth/microsoft/login' };
const renderSection = (reconnect: string | null = null) =>
  render(<StorageSection onNotify={vi.fn()} reconnect={reconnect} returnTo={null} />);

const assign = vi.fn();
beforeEach(() => {
  api.providers = [];
  api.microsoft = { isPending: false, error: null, data: [] };
  api.nextcloud = { isPending: false, error: null, data: [] };
  api.google = { isPending: false, error: null, data: [] };
  api.googleDrive = false;
  for (const fn of [api.disconnectMicrosoft, api.disconnectNextcloud, api.disconnectGoogle, assign])
    fn.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());

const openConnectMenu = async (name: string) => {
  // Twice: beside the heading, and full width on a phone.
  await userEvent.click(screen.getAllByRole('button', { name })[0]!);
  return screen.getByRole('menu', { name: 'Speicherort verbinden' });
};

describe('StorageSection', () => {
  it('without any account: one hint, and one menu that offers Microsoft and Nextcloud', async () => {
    api.providers = [MICROSOFT_PROVIDER];
    renderSection();
    expect(screen.getByText(/Noch kein Speicherort verbunden/)).toBeTruthy();
    const menu = await openConnectMenu('Konto verbinden');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['OneDrive & SharePoint', 'Nextcloud']);

    await userEvent.click(items[0]!);
    expect(assign).toHaveBeenCalledWith('/api/auth/microsoft/login?returnTo=%2Fkonto');
  });

  it('offers Google Drive with it set up, and lists its accounts (BER-119)', async () => {
    api.googleDrive = true;
    renderSection();
    expect(screen.getByText(/Verbinde Google Drive oder eine Nextcloud/)).toBeTruthy();
    // No account connected, no hint about whose access counts.
    expect(screen.queryByText(/sehen alle Mitglieder des Workspace/)).toBeNull();
    const menu = await openConnectMenu('Konto verbinden');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Google Drive', 'Nextcloud']);
    await userEvent.click(items[0]!);
    expect(assign).toHaveBeenCalledWith('/api/auth/google/drive?returnTo=%2Fkonto');
  });

  it('reconnects a Google account Google refused', async () => {
    api.google.data = [
      {
        id: 'g1',
        account: 'anna@gmail.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        deckCount: 2,
        needsReconnect: true,
      },
    ];
    renderSection();
    expect(screen.getByText('Google Drive | 2 Reviews synchronisieren darüber')).toBeTruthy();
    // The source's sharing doesn't count in Slider: the hint says who sees such reviews.
    expect(screen.getByText(/sehen alle Mitglieder des Workspace/).textContent).toMatch(
      /Freigaben in OneDrive, SharePoint, Nextcloud oder Google Drive\s+gelten in Slider nicht/,
    );
    expect(screen.getByText(/sehen alle Mitglieder des Workspace/).textContent).toMatch(
      /per Rechtsklick auf die Review ein \(„Zugriff einschränken …“\)\./,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Neu verbinden' }));
    expect(assign).toHaveBeenCalledWith('/api/auth/google/drive?returnTo=%2Fkonto&connection=g1');
  });

  it('offers only Nextcloud on a server without Microsoft', async () => {
    renderSection();
    const menu = await openConnectMenu('Konto verbinden');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Nextcloud']);
  });

  it('opens the Nextcloud form from the menu and closes it again', async () => {
    renderSection();
    await userEvent.click(within(await openConnectMenu('Konto verbinden')).getByRole('menuitem'));
    expect(screen.getByRole('form', { name: 'Nextcloud-Formular' })).toBeTruthy();
    expect(screen.queryByText(/Noch kein Speicherort verbunden/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('form', { name: 'Nextcloud-Formular' })).toBeNull();
  });

  it('lists Microsoft and Nextcloud accounts in one list with the reviews syncing through them', async () => {
    api.microsoft.data = [
      microsoft({ deckCount: 3 }),
      microsoft({ id: 'c3', account: null, needsReconnect: true }),
    ];
    api.nextcloud.data = [nextcloud({ deckCount: 1 })];
    renderSection();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('anna@firma.deOneDrive & SharePoint | 3 Reviews synchronisieren'),
      expect.stringContaining('Microsoft-KontoAnmeldung abgelaufen'),
      expect.stringContaining('annaNextcloud (cloud.firma.de) | 1 Review synchronisiert'),
    ]);
    // An expired one is renewed with that very account preselected.
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Neu verbinden' }));
    expect(assign).toHaveBeenLastCalledWith(
      '/api/auth/microsoft/login?connection=c3&returnTo=%2Fkonto',
    );
    expect(screen.getAllByRole('button', { name: 'Weiteres Konto verbinden' })).toHaveLength(2);
  });

  it('reconnects a Nextcloud with its server filled in', async () => {
    api.nextcloud.data = [nextcloud({ needsReconnect: true })];
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Neu verbinden' }));
    expect(
      screen.getByRole('form', { name: 'Nextcloud-Formular' }).getAttribute('data-server'),
    ).toBe('https://cloud.firma.de');
    expect(screen.getByText(/Verbinde dein Konto bei cloud.firma.de erneut/)).toBeTruthy();
  });

  it('says how many reviews lose their updates before disconnecting', async () => {
    const onNotify = vi.fn();
    api.microsoft.data = [microsoft({ deckCount: 2 })];
    render(<StorageSection onNotify={onNotify} reconnect={null} returnTo={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen für anna@firma.de' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Trennen' }));
    const dialog = screen.getByRole('dialog', { name: 'anna@firma.de trennen?', hidden: true });
    expect(dialog.textContent).toContain(
      '2 Reviews werden dann nicht mehr automatisch aktualisiert',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Trennen', hidden: true }));
    expect(api.disconnectMicrosoft).toHaveBeenCalledWith('c1', expect.anything());
    const { onSuccess } = api.disconnectMicrosoft.mock.calls[0]![1] as { onSuccess: () => void };
    onSuccess();
    expect(onNotify).toHaveBeenCalledWith('anna@firma.de getrennt');
  });
});
