import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_KEYS, type SetupField, type SetupKey, type SetupStatus } from '@slider/shared';
import { NotAuthorized, SetupForm } from './SetupForm';

// Records the calls; the promise comes from a plain function (a rejected promise returned by a
// `vi.fn` itself is reported as unhandled by vitest's result tracking).
const apiRequest = vi.hoisted(() => vi.fn());
let fail: Error | null = null;
let restart: 'manual' | 'automatic' = 'manual';
const me = vi.hoisted(() => ({ user: null as { name: string; email: string } | null }));
const logout = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => {
    apiRequest(...args);
    return fail ? Promise.reject(fail) : Promise.resolve({ restart });
  },
  api: {
    get: () => Promise.resolve({ user: me.user, viewer: {} }),
    post: () => logout(),
  },
}));

const EMPTY: SetupField = { source: null, value: null, set: false };

function status(
  fields: Partial<Record<SetupKey, SetupField>> = {},
  overrides: Partial<SetupStatus> = {},
): SetupStatus & { settings: NonNullable<SetupStatus['settings']> } {
  return {
    authorized: true,
    hasAccount: true,
    loginConfigured: true,
    ...overrides,
    settings: {
      url: 'https://slider.firma.de',
      restart: 'manual',
      redirectUris: {
        microsoft: 'https://slider.firma.de/api/auth/microsoft/callback',
        google: 'https://slider.firma.de/api/auth/google/callback',
        oidc: 'https://slider.firma.de/api/auth/oidc/callback',
      },
      fields: Object.fromEntries(SETUP_KEYS.map((key) => [key, fields[key] ?? EMPTY])) as Record<
        SetupKey,
        SetupField
      >,
    },
  };
}

function wrap(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderForm(s = status()) {
  render(wrap(<SetupForm status={s} settings={s.settings} headers={{ 'X-Setup-Token': 't' }} />));
}

const section = (name: string) => screen.getByRole('region', { name });

describe('NotAuthorized', () => {
  it('after the first account: only the admin, with a link to the login', () => {
    render(wrap(<NotAuthorized status={status({}, { hasAccount: true })} />));
    const link = screen.getByRole('link', { name: 'Als Admin anmelden' });
    expect(link.getAttribute('href')).toContain('/login');
    expect(link.getAttribute('href')).toContain('einrichtung');
  });

  it('signed in with another account: says which, and signs out before the login', async () => {
    me.user = { name: 'Anna', email: 'anna@firma.de' };
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(wrap(<NotAuthorized status={status({}, { hasAccount: true })} />));
    const button = await screen.findByRole('button', { name: 'Mit anderem Konto anmelden' });
    expect(screen.getByText(/Du bist als Anna \(anna@firma\.de\) angemeldet/)).toBeTruthy();
    // The login would send this account straight back here.
    expect(screen.queryByRole('link', { name: 'Als Admin anmelden' })).toBeNull();
    await userEvent.click(button);
    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?returnTo=%2Feinrichtung'));
    vi.unstubAllGlobals();
    me.user = null;
  });

  it('before it: points to the setup link in the server log', () => {
    render(wrap(<NotAuthorized status={status({}, { hasAccount: false })} />));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('docker logs slider').tagName).toBe('CODE');
  });
});

describe('SetupForm', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    fail = null;
  });

  it('asks for the admin address only before the first account', () => {
    renderForm(status({}, { hasAccount: false }));
    expect(screen.getByLabelText('Deine E-Mail-Adresse')).toBeTruthy();
  });

  it('no admin address once an account exists', () => {
    renderForm(status({}, { hasAccount: true }));
    expect(screen.queryByLabelText('Deine E-Mail-Adresse')).toBeNull();
  });

  it('values from the environment are read-only', () => {
    renderForm(status({ MS_CLIENT_ID: { source: 'env', value: 'abc', set: true } }));
    const input = screen.getByLabelText('Anwendungs-ID (Client-ID)') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('abc');
    expect(within(section('Microsoft')).getByText('Per Umgebungsvariable gesetzt')).toBeTruthy();
  });

  it('"Nur bestimmte E-Mail-Domains" shows the domains field', async () => {
    renderForm();
    expect(screen.queryByLabelText('Domains')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Neue Konten'), 'domains');
    expect(screen.getByLabelText('Domains')).toBeTruthy();
  });

  it('removes a stored section on save and says to restart (manual restart)', async () => {
    renderForm(
      status({
        GOOGLE_CLIENT_ID: { source: 'stored', value: 'g-id', set: true },
        GOOGLE_CLIENT_SECRET: { source: 'stored', value: null, set: true },
      }),
    );
    expect(within(section('Microsoft')).queryByRole('button', { name: 'Entfernen' })).toBeNull();
    await userEvent.click(within(section('Google')).getByRole('button', { name: 'Entfernen' }));
    expect(within(section('Google')).getAllByText('Wird beim Speichern entfernt')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(apiRequest).toHaveBeenCalledWith('/setup', {
      method: 'PUT',
      body: { values: { GOOGLE_CLIENT_ID: null, GOOGLE_CLIENT_SECRET: null } },
      headers: { 'X-Setup-Token': 't' },
    });
    expect(await screen.findByText(/Starte den Slider-Server neu/)).toBeTruthy();
  });

  it('locks a removed section and offers "Rückgängig" – nothing typed is dropped silently', async () => {
    renderForm(
      status({
        MS_CLIENT_ID: { source: 'stored', value: 'old-id', set: true },
        MS_CLIENT_SECRET: { source: 'stored', value: null, set: true },
        SMTP_URL: { source: 'stored', value: null, set: true },
      }),
    );
    const microsoft = within(section('Microsoft'));
    const clientId = () => microsoft.getByLabelText(/Client-ID/) as HTMLInputElement;
    await userEvent.click(microsoft.getByRole('button', { name: 'Entfernen' }));
    expect(clientId().disabled).toBe(true);

    // Changed their mind: undo, then type the new app's ID – that is what gets saved.
    await userEvent.click(microsoft.getByRole('button', { name: 'Rückgängig' }));
    expect(microsoft.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
    expect(clientId().disabled).toBe(false);
    await userEvent.clear(clientId());
    await userEvent.type(clientId(), 'new-id');

    // The SMTP fields lock the same way.
    const mail = within(section('E-Mail'));
    await userEvent.click(mail.getByRole('button', { name: 'Entfernen' }));
    expect((mail.getByLabelText('SMTP-Server') as HTMLInputElement).disabled).toBe(true);
    expect(mail.getByText(/wird beim Speichern entfernt/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(apiRequest).toHaveBeenLastCalledWith('/setup', {
      method: 'PUT',
      body: { values: { MS_CLIENT_ID: 'new-id', SMTP_URL: null } },
      headers: { 'X-Setup-Token': 't' },
    });
  });

  it('shows a failed save', async () => {
    fail = new Error('Speichern fehlgeschlagen');
    renderForm();
    await userEvent.type(within(section('Google')).getByLabelText('Client-ID'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Speichern fehlgeschlagen')).toBeTruthy();
  });

  it('after an automatic restart the form shows what the server now has', async () => {
    restart = 'automatic';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const before = status({
      MS_CLIENT_ID: { source: 'stored', value: 'abc', set: true },
      MS_CLIENT_SECRET: { source: 'stored', value: null, set: true },
    });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    // What `/setup` answers after the restart: Microsoft is gone.
    client.setQueryData(['setup'], status());
    render(
      wrap(
        <SetupForm status={before} settings={before.settings} headers={{ 'X-Setup-Token': 't' }} />,
        client,
      ),
    );
    const clientId = () =>
      within(section('Microsoft')).getByLabelText(/Client-ID/) as HTMLInputElement;
    expect(clientId().value).toBe('abc');
    await userEvent.click(within(section('Microsoft')).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(clientId().value).toBe(''), { timeout: 3000 });
    restart = 'manual';
    vi.unstubAllGlobals();
  });

  it('a server that does not come back is reported as such, next to the button', async () => {
    restart = 'automatic';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let up = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (!up) throw new TypeError('Failed to fetch');
        return new Response('{}', { status: 200 });
      }),
    );
    const s = status();
    s.settings.restart = 'automatic';
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(['setup'], s);
    render(
      wrap(
        <SetupForm status={s} settings={s.settings} headers={{ 'X-Setup-Token': 't' }} />,
        client,
      ),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(within(section('Google')).getByLabelText('Client-ID'), 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await act(() => vi.advanceTimersByTimeAsync(40_000));

    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('Slider antwortet noch nicht');
    expect(screen.queryByText(/übernommen/)).toBeNull();
    // Below the last section, right above "Speichern" – where the admin clicked.
    const saveButton = screen.getByRole('button', { name: 'Speichern' });
    expect(
      section('E-Mail').compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      warning.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    up = true;
    await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Gespeichert und übernommen.',
    );
    expect(screen.queryByText('Slider antwortet noch nicht')).toBeNull();

    vi.useRealTimers();
    restart = 'manual';
    vi.unstubAllGlobals();
  });
});
