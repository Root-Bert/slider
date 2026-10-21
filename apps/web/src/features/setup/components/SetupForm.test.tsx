import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_KEYS, type SetupField, type SetupKey, type SetupStatus } from '@slider/shared';
import { SetupForm } from './SetupForm';

// Records the calls; the promise comes from a plain function (a rejected promise returned by a
// `vi.fn` itself is reported as unhandled by vitest's result tracking).
const apiRequest = vi.hoisted(() => vi.fn());
let fail: Error | null = null;
let restart: 'manual' | 'automatic' = 'manual';
vi.mock('@/lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => {
    apiRequest(...args);
    return fail ? Promise.reject(fail) : Promise.resolve({ restart });
  },
  // The legal texts card (`GET /legal`).
  api: { get: () => Promise.resolve({ imprint: null, privacy: null }) },
}));

const EMPTY: SetupField = { source: null, value: null, set: false };

function status(
  fields: Partial<Record<SetupKey, SetupField>> = {},
  overrides: Partial<SetupStatus> = {},
): SetupStatus & { settings: NonNullable<SetupStatus['settings']> } {
  return {
    authorized: true,
    claimed: true,
    claimable: false,
    loginConfigured: true,
    ...overrides,
    settings: {
      url: 'https://slider.firma.de',
      restart: 'manual',
      redirectUris: {
        microsoft: 'https://slider.firma.de/api/auth/microsoft/callback',
        google: 'https://slider.firma.de/api/auth/google/callback',
        oidc: 'https://slider.firma.de/api/auth/oidc/callback',
        nextcloud: 'https://slider.firma.de/api/auth/nextcloud/callback',
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
  render(
    wrap(
      <SetupForm
        status={s}
        settings={s.settings}
        headers={{ 'X-Setup-Token': 't' }}
        onNotify={() => {}}
      />,
    ),
  );
}

const section = (name: string) => screen.getByRole('region', { name });
// The form's own button – the legal texts card saves on its own with another "Speichern".
const submitButton = () =>
  screen
    .getAllByRole('button', { name: 'Speichern' })
    .find((button) => button.getAttribute('type') === 'submit')!;

describe('SetupForm', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    fail = null;
  });

  it('asks for no admin address: before an admin exists it says how to become one', () => {
    renderForm(status({}, { claimed: false, loginConfigured: true }));
    expect(screen.queryByLabelText('Deine E-Mail-Adresse')).toBeNull();
    expect(screen.getByText(/Anmelden macht niemanden zum Admin/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Zur Anmeldung' });
    expect(link.getAttribute('href')).toBe('/login?returnTo=%2Feinrichtung');
  });

  it('no such hint without a login yet, or once the instance has its admin', () => {
    renderForm(status({}, { claimed: false, loginConfigured: false }));
    expect(screen.queryByText(/Anmelden macht niemanden zum Admin/)).toBeNull();
    cleanup();
    renderForm(status({}, { claimed: true }));
    expect(screen.queryByText(/Anmelden macht niemanden zum Admin/)).toBeNull();
  });

  it('values from the environment are read-only', () => {
    renderForm(status({ MS_CLIENT_ID: { source: 'env', value: 'abc', set: true } }));
    const input = screen.getByLabelText('Anwendungs-ID (Client-ID)') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('abc');
    expect(within(section('Microsoft')).getByText('Nur in der .env änderbar')).toBeTruthy();
    // The card says so too, and the page explains the mark once.
    expect(within(section('Microsoft')).getByText('.env')).toBeTruthy();
    expect(screen.getByText(/Ändern geht nur dort, danach Slider/)).toBeTruthy();
  });

  it('no explanation of `.env` when nothing comes from it', () => {
    renderForm();
    expect(screen.queryByText(/Ändern geht nur dort, danach Slider/)).toBeNull();
  });

  it('groups the cards and says for each whether it is set up', () => {
    renderForm(
      status({
        MS_CLIENT_ID: { source: 'stored', value: 'abc', set: true },
        MS_CLIENT_SECRET: { source: 'stored', value: null, set: true },
        SMTP_URL: { source: 'env', value: 'smtps://u@smtp.firma.de:465', set: true },
      }),
    );
    for (const name of ['Anmeldung', 'Zugang', 'E-Mail', 'Server']) {
      expect(screen.getByRole('group', { name })).toBeTruthy();
    }
    expect(within(section('Microsoft')).getByText('Eingerichtet')).toBeTruthy();
    expect(within(section('Firmen-Login (SSO)')).getByText('Nicht eingerichtet')).toBeTruthy();
    expect(within(section('Mailserver')).getByText('.env')).toBeTruthy();
    expect(within(section('Adresse')).getByText('.env')).toBeTruthy();
  });

  it('imprint and privacy policy for the signed-in admin; before an admin exists only a hint', async () => {
    renderForm();
    const legal = within(screen.getByRole('group', { name: 'Rechtliches' }));
    expect(await legal.findByLabelText('Impressum')).toBeTruthy();
    expect(legal.getByLabelText('Datenschutzerklärung')).toBeTruthy();
    cleanup();
    renderForm(status({}, { claimed: false }));
    const hint = within(section('Impressum & Datenschutz'));
    expect(hint.getByText(/sobald du als Admin dieser Instanz angemeldet bist/)).toBeTruthy();
    expect(hint.queryByLabelText('Impressum')).toBeNull();
  });

  it('a mail server from the environment is shown, locked', () => {
    renderForm(
      status({
        SMTP_URL: { source: 'env', value: 'smtp://u%40firma.de@smtp.firma.de:587', set: true },
      }),
    );
    const mail = within(section('Mailserver'));
    const host = mail.getByLabelText('SMTP-Server') as HTMLInputElement;
    expect(host.value).toBe('smtp.firma.de');
    expect(host.readOnly).toBe(true);
    expect((mail.getByLabelText('Benutzer') as HTMLInputElement).value).toBe('u@firma.de');
    expect((mail.getByLabelText('Port') as HTMLInputElement).value).toBe('587');
  });

  it('shows the saved mail server and changes it without retyping the password', async () => {
    const saved = 'smtps://u@smtp.firma.de:465';
    renderForm(status({ SMTP_URL: { source: 'stored', value: saved, set: true } }));
    const mail = within(section('Mailserver'));
    const port = mail.getByLabelText('Port') as HTMLInputElement;
    expect((mail.getByLabelText('SMTP-Server') as HTMLInputElement).value).toBe('smtp.firma.de');
    expect(port.value).toBe('465');
    expect(mail.getByPlaceholderText('Gespeichert – leer lassen zum Behalten')).toBeTruthy();

    // Unchanged: nothing about the mail server is sent.
    await userEvent.click(submitButton());
    expect(apiRequest).toHaveBeenLastCalledWith(
      '/setup',
      expect.objectContaining({ body: { values: {} } }),
    );

    await userEvent.clear(port);
    await userEvent.type(port, '587');
    await userEvent.click(submitButton());
    expect(apiRequest).toHaveBeenLastCalledWith(
      '/setup',
      expect.objectContaining({ body: { values: { SMTP_URL: 'smtp://u@smtp.firma.de:587' } } }),
    );
  });

  it('another mail user asks for its password', async () => {
    renderForm(
      status({ SMTP_URL: { source: 'stored', value: 'smtps://u@smtp.firma.de:465', set: true } }),
    );
    const user = within(section('Mailserver')).getByLabelText('Benutzer');
    await userEvent.type(user, 'x');
    expect(screen.getByText('Neuer Benutzer – Passwort eingeben')).toBeTruthy();
  });

  it('shows the Google login, which brings Google Drive along (BER-119)', () => {
    renderForm();
    expect(screen.getByRole('region', { name: 'Google' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Google Drive' })).toBeNull();
  });

  it('"Nur bestimmte E-Mail-Domains" shows the domains field', async () => {
    renderForm();
    expect(screen.queryByLabelText('Domains')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Neue Konten'), 'domains');
    expect(screen.getByLabelText('Domains')).toBeTruthy();
  });

  it('deleting unused data is on until the admin turns it off, reminders need mail', async () => {
    renderForm();
    const unused = within(section('Ungenutzte Daten löschen'));
    const choice = unused.getByLabelText('Automatisch löschen');
    expect((choice as HTMLSelectElement).value).toBe('true');
    expect(unused.getByText(/Erinnerungen vor dem Löschen kommen nur per Mail/)).toBeTruthy();
    await userEvent.selectOptions(choice, 'false');
    expect(unused.queryByText(/Erinnerungen vor dem Löschen/)).toBeNull();
    await userEvent.click(submitButton());
    expect(apiRequest).toHaveBeenCalledWith('/setup', {
      method: 'PUT',
      body: { values: { DELETE_UNUSED: 'false' } },
      headers: { 'X-Setup-Token': 't' },
    });
  });

  it('removes a stored section on save and says to restart (manual restart)', async () => {
    renderForm(
      status({
        OIDC_CLIENT_ID: { source: 'stored', value: 'o-id', set: true },
        OIDC_CLIENT_SECRET: { source: 'stored', value: null, set: true },
      }),
    );
    expect(within(section('Microsoft')).queryByRole('button', { name: 'Entfernen' })).toBeNull();
    await userEvent.click(
      within(section('Firmen-Login (SSO)')).getByRole('button', { name: 'Entfernen' }),
    );
    expect(
      within(section('Firmen-Login (SSO)')).getAllByText('Wird beim Speichern entfernt'),
    ).toHaveLength(4);

    await userEvent.click(submitButton());
    expect(apiRequest).toHaveBeenCalledWith('/setup', {
      method: 'PUT',
      body: { values: { OIDC_CLIENT_ID: null, OIDC_CLIENT_SECRET: null } },
      headers: { 'X-Setup-Token': 't' },
    });
    expect(await screen.findByText(/Starte den Slider-Server neu/)).toBeTruthy();
  });

  it('locks a removed section and offers "Rückgängig" – nothing typed is dropped silently', async () => {
    renderForm(
      status({
        MS_CLIENT_ID: { source: 'stored', value: 'old-id', set: true },
        MS_CLIENT_SECRET: { source: 'stored', value: null, set: true },
        SMTP_URL: { source: 'stored', value: 'smtps://u@smtp.firma.de:465', set: true },
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
    const mail = within(section('Mailserver'));
    await userEvent.click(mail.getByRole('button', { name: 'Entfernen' }));
    expect((mail.getByLabelText('SMTP-Server') as HTMLInputElement).disabled).toBe(true);
    expect(mail.getAllByText('Wird beim Speichern entfernt').length).toBeGreaterThan(0);
    expect(mail.getByText('Wird entfernt')).toBeTruthy();

    await userEvent.click(submitButton());
    expect(apiRequest).toHaveBeenLastCalledWith('/setup', {
      method: 'PUT',
      body: { values: { MS_CLIENT_ID: 'new-id', SMTP_URL: null } },
      headers: { 'X-Setup-Token': 't' },
    });
  });

  it('shows a failed save', async () => {
    fail = new Error('Speichern fehlgeschlagen');
    renderForm();
    await userEvent.type(within(section('Firmen-Login (SSO)')).getByLabelText('Client-ID'), 'x');
    await userEvent.click(submitButton());
    expect(await screen.findByText('Speichern fehlgeschlagen')).toBeTruthy();
  });

  it('after an automatic restart the form shows what the server now has', async () => {
    restart = 'automatic';
    // The old server still answers once, then is down, then the restarted one answers.
    const health = [200, 502];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: health.shift() ?? 200 })),
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
        <SetupForm
          status={before}
          settings={before.settings}
          headers={{ 'X-Setup-Token': 't' }}
          onNotify={() => {}}
        />,
        client,
      ),
    );
    const clientId = () =>
      within(section('Microsoft')).getByLabelText(/Client-ID/) as HTMLInputElement;
    expect(clientId().value).toBe('abc');
    await userEvent.click(within(section('Microsoft')).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(submitButton());
    await waitFor(() => expect(clientId().value).toBe(''), { timeout: 5000 });
    expect(health).toEqual([]);
    restart = 'manual';
    vi.unstubAllGlobals();
  });

  it('waits for the restarted server by its boot id, however long the old one still answers', async () => {
    restart = 'automatic';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let bootId = 'old';
    const fetchMock = vi.fn(async () => Response.json({ ok: true, bootId }));
    vi.stubGlobal('fetch', fetchMock);
    const s = status();
    s.settings.restart = 'automatic';
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(['setup'], s);
    render(
      wrap(
        <SetupForm
          status={s}
          settings={s.settings}
          headers={{ 'X-Setup-Token': 't' }}
          onNotify={() => {}}
        />,
        client,
      ),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(within(section('Firmen-Login (SSO)')).getByLabelText('Client-ID'), 'x');
    await user.click(submitButton());
    // Past the 10 s an old server without boot ids gets: still the one from before saving.
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.queryByText(/übernommen/)).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(20);

    bootId = 'new';
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Gespeichert und übernommen.',
    );

    vi.useRealTimers();
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
        <SetupForm
          status={s}
          settings={s.settings}
          headers={{ 'X-Setup-Token': 't' }}
          onNotify={() => {}}
        />,
        client,
      ),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(within(section('Firmen-Login (SSO)')).getByLabelText('Client-ID'), 'x');
    await user.click(submitButton());
    await act(() => vi.advanceTimersByTimeAsync(40_000));

    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('Slider antwortet noch nicht');
    expect(screen.queryByText(/übernommen/)).toBeNull();
    // Below the last section, right above "Speichern" – where the admin clicked.
    const saveButton = submitButton();
    expect(
      section('Adresse').compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
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
