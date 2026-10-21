import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from '@slider/shared';
import { storedSetupToken, storeSetupToken } from '../lib/setup-form';
import { NotAuthorized } from './NotAuthorized';

const apiRequest = vi.hoisted(() => vi.fn());
let claimError: Error | null = null;
const me = vi.hoisted(() => ({ user: null as { name: string; email: string } | null }));
const logout = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => {
    apiRequest(...args);
    return claimError ? Promise.reject(claimError) : Promise.resolve({ claimed: true });
  },
  api: {
    get: () => Promise.resolve({ user: me.user, viewer: {} }),
    post: () => logout(),
  },
}));

const status = (overrides: Partial<SetupStatus> = {}): SetupStatus => ({
  authorized: false,
  claimed: false,
  claimable: false,
  loginConfigured: true,
  ...overrides,
});

function renderNotAuthorized(
  s: SetupStatus,
  { rejected = false, initialToken = null as string | null, onToken = vi.fn() } = {},
) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(
    wrap(
      <NotAuthorized
        status={s}
        rejected={rejected}
        initialToken={initialToken}
        onToken={onToken}
      />,
    ),
  );
  return { onToken, invalidate };
}

beforeEach(() => {
  apiRequest.mockReset();
  logout.mockClear();
  claimError = null;
  me.user = null;
});
afterEach(() => storeSetupToken(null));

describe('NotAuthorized – an instance admin exists', () => {
  it('signed out: only the admin, with a link to the login', () => {
    renderNotAuthorized(status({ claimed: true }));
    const link = screen.getByRole('link', { name: 'Als Admin anmelden' });
    expect(link.getAttribute('href')).toContain('/login');
    expect(link.getAttribute('href')).toContain('einrichtung');
    expect(screen.queryByLabelText('Setup-Token')).toBeNull();
  });

  it('signed in with another account: says which, and signs out before the login', async () => {
    me.user = { name: 'Anna', email: 'anna@firma.de' };
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderNotAuthorized(status({ claimed: true }));
    const button = await screen.findByRole('button', { name: 'Mit anderem Konto anmelden' });
    expect(screen.getByText(/Du bist als Anna \(anna@firma\.de\) angemeldet/)).toBeTruthy();
    // The login would send this account straight back here.
    expect(screen.queryByRole('link', { name: 'Als Admin anmelden' })).toBeNull();
    await userEvent.click(button);
    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?returnTo=%2Feinrichtung'));
    vi.unstubAllGlobals();
  });
});

describe('NotAuthorized – no admin yet, signed out', () => {
  it('asks for the setup token from the server log and opens the page with it', async () => {
    const { onToken } = renderNotAuthorized(status());
    expect(
      screen.getByRole('heading', { name: 'Setup-Token aus dem Server-Log eingeben' }),
    ).toBeTruthy();
    expect(screen.getByText('docker logs slider').tagName).toBe('CODE');
    // No link from the log any more: the token is typed in, never part of a URL.
    expect(screen.queryByText(/#token=/)).toBeNull();
    const submit = screen.getByRole('button', { name: 'Weiter' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Setup-Token'), '  Setup token: abc-123  ');
    await userEvent.click(submit);
    expect(onToken).toHaveBeenCalledWith('abc-123');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('says when the token was not taken', () => {
    renderNotAuthorized(status(), { rejected: true });
    expect(screen.getByText(/Der Setup-Token stimmt nicht/)).toBeTruthy();
    expect(screen.getByLabelText('Setup-Token').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('NotAuthorized – no admin yet, signed in', () => {
  it('claims the instance with the token, then reloads the page and the account', async () => {
    me.user = { name: 'Anna', email: 'anna@firma.de' };
    storeSetupToken('abc-123');
    const { invalidate, onToken } = renderNotAuthorized(status({ claimable: true }), {
      initialToken: 'abc-123',
    });
    expect(screen.getByRole('heading', { name: 'Setup-Token eingeben' })).toBeTruthy();
    expect(await screen.findByText(/als Anna \(anna@firma\.de\)/)).toBeTruthy();
    expect(screen.getByText('docker logs slider').tagName).toBe('CODE');
    // Typed in before signing in: ready to use.
    expect((screen.getByLabelText('Setup-Token') as HTMLInputElement).value).toBe('abc-123');

    await userEvent.click(screen.getByRole('button', { name: 'Admin werden' }));
    expect(apiRequest).toHaveBeenCalledWith('/setup/claim', {
      method: 'POST',
      headers: { 'X-Setup-Token': 'abc-123' },
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['setup'] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
    // Used up on the server: gone here too.
    expect(storedSetupToken()).toBeNull();
    expect(onToken).not.toHaveBeenCalled();
  });

  it('the only other way out is signing out', async () => {
    me.user = { name: 'Anna', email: 'anna@firma.de' };
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderNotAuthorized(status({ claimable: true }));
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    vi.unstubAllGlobals();
  });

  it('shows why a claim failed, next to the field', async () => {
    claimError = new Error('Der Setup-Token stimmt nicht. Den aktuellen findest du im Server-Log.');
    renderNotAuthorized(status({ claimable: true }));
    await userEvent.type(screen.getByLabelText('Setup-Token'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Admin werden' }));
    expect(await screen.findByText(/Den aktuellen findest du im Server-Log/)).toBeTruthy();
    expect(screen.getByLabelText('Setup-Token').getAttribute('aria-invalid')).toBe('true');
  });
});
