import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './AccountMenu';

const api = vi.hoisted(() => ({
  me: null as unknown,
  providers: [] as { id: string }[],
  passkeys: [] as unknown[] | undefined,
  logout: vi.fn(),
  logoutFailed: false,
  hintDismissed: false,
  dismissHint: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useMe: () => ({ data: api.me }),
  useAuthProviders: () => ({ data: { providers: api.providers } }),
  useLogout: () => ({ mutate: api.logout, isPending: false, isError: api.logoutFailed }),
  usePasskeys: () => ({ data: api.passkeys }),
}));

vi.mock('@/lib/passkeys', () => ({
  passkeysSupported: () => true,
  passkeyHintDismissed: () => api.hintDismissed,
  dismissPasskeyHint: api.dismissHint,
}));

const author = { id: 'u1', name: 'Anna Berg', type: 'owner', color: 'blue' } as const;

function signIn(
  user: Partial<{
    microsoftConnected: boolean;
    microsoftConnections: number;
    isInstanceAdmin: boolean;
  }> = {},
) {
  api.me = {
    viewer: { author },
    user: {
      id: 'u1',
      name: 'Anna Berg',
      email: 'anna@firma.de',
      microsoftConnected: false,
      microsoftConnections: 0,
      isInstanceAdmin: false,
      ...user,
    },
  };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AccountMenu />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('button', { name: 'Konto: Anna Berg' });
}

beforeEach(() => {
  signIn();
  api.providers = [];
  api.passkeys = [{ id: 'p1' }];
  api.hintDismissed = false;
  api.logout.mockReset();
  api.dismissHint.mockReset();
});

describe('AccountMenu', () => {
  it('is only an avatar for a guest without an account', () => {
    api.me = { viewer: { author } };
    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a panel with who is signed in; Escape closes it and refocuses the trigger', async () => {
    const trigger = setup();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-controls')).toBe(false);

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel.className).toContain('z-(--z-popover)');
    expect(panel.textContent).toContain('Anna Berg');
    expect(panel.textContent).toContain('anna@firma.de');
    // No Microsoft row when the instance has no Microsoft login.
    expect(screen.queryByText(/Microsoft/)).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('navigates to the account and the preferences and closes', async () => {
    const trigger = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Konto & Anmeldung' }));
    expect(screen.getByTestId('where').textContent).toBe('/konto');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(screen.getByTestId('where').textContent).toBe('/einstellungen');
  });

  it('gives the instance admin a section of its own: setup and dashboard (BER-167)', async () => {
    signIn({ isInstanceAdmin: true });
    const trigger = setup();
    await userEvent.click(trigger);
    expect(screen.getByText('Instanz')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Instanz-Einstellungen' }));
    expect(screen.getByTestId('where').textContent).toBe('/einrichtung');

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Instanz-Dashboard' }));
    expect(screen.getByTestId('where').textContent).toBe('/instanz');
  });

  it('shows no instance section to anyone else', async () => {
    await userEvent.click(setup());
    expect(screen.queryByText('Instanz')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Instanz-Dashboard' })).toBeNull();
  });

  it('offers to connect Microsoft as a full page link, or shows it connected', async () => {
    api.providers = [{ id: 'microsoft' }];
    const trigger = setup();
    await userEvent.click(trigger);
    const connect = screen.getByRole('link', { name: /Microsoft verbinden/ });
    expect(connect.getAttribute('href')).toMatch(/^\/api\/auth\/microsoft\/login/);
  });

  it('shows connected Microsoft accounts and manages them on the account page', async () => {
    signIn({ microsoftConnected: true, microsoftConnections: 2 });
    const trigger = setup();
    await userEvent.click(trigger);
    const row = screen.getByRole('button', { name: /Microsoft verbunden/ });
    expect(row.textContent).toContain('2 Konten');
    expect(screen.queryByRole('link', { name: /Microsoft verbinden/ })).toBeNull();
    await userEvent.click(row);
    expect(screen.getByTestId('where').textContent).toBe('/konto');
  });

  it('nudges to add a passkey until the hint is dismissed', async () => {
    api.passkeys = [];
    const trigger = setup();
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: /Schneller anmelden/ })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Hinweis ausblenden' }));
    expect(api.dismissHint).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /Schneller anmelden/ })).toBeNull();
    // The menu stays open, and the focus moves on instead of dropping to <body>.
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Konto & Anmeldung' }));
  });

  it('an item that closes the menu hands the focus back to the trigger', async () => {
    const trigger = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('says so when signing out failed', async () => {
    api.logoutFailed = true;
    const trigger = setup();
    await userEvent.click(trigger);
    expect(screen.getByRole('alert').textContent).toBe(
      'Abmelden hat nicht geklappt – bitte erneut versuchen.',
    );
    api.logoutFailed = false;
  });

  it('signs out', async () => {
    const trigger = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(api.logout).toHaveBeenCalledOnce();
  });
});
