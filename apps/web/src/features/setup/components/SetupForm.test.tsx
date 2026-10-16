import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
vi.mock('@/lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => {
    apiRequest(...args);
    return fail ? Promise.reject(fail) : Promise.resolve({ restart: 'manual' });
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

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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

  it('shows a failed save', async () => {
    fail = new Error('Speichern fehlgeschlagen');
    renderForm();
    await userEvent.type(within(section('Google')).getByLabelText('Client-ID'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Speichern fehlgeschlagen')).toBeTruthy();
  });
});
