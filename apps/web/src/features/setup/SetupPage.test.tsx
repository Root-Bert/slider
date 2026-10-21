import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETUP_KEYS, type SetupField, type SetupKey, type SetupStatus } from '@slider/shared';
import { Component as SetupPage } from './SetupPage';

const EMPTY: SetupField = { source: null, value: null, set: false };
const STATUS: SetupStatus = {
  authorized: true,
  claimed: true,
  claimable: false,
  loginConfigured: true,
  settings: {
    url: 'https://slider.firma.de',
    restart: 'automatic',
    redirectUris: {
      microsoft: 'https://slider.firma.de/api/auth/microsoft/callback',
      google: 'https://slider.firma.de/api/auth/google/callback',
      oidc: 'https://slider.firma.de/api/auth/oidc/callback',
      nextcloud: 'https://slider.firma.de/api/auth/nextcloud/callback',
    },
    fields: Object.fromEntries(SETUP_KEYS.map((key) => [key, EMPTY])) as Record<
      SetupKey,
      SetupField
    >,
  },
};

const setup = vi.hoisted(() => ({
  fail: false,
  /** `null`: every request is authorized; else only one with this token. */
  token: null as string | null,
  calls: [] as { headers?: Record<string, string> }[],
}));
vi.mock('@/lib/api-client', () => ({
  apiRequest: (_path: string, init: { headers?: Record<string, string> } = {}) => {
    setup.calls.push(init);
    if (setup.fail) return Promise.reject(new Error('Keine Verbindung zum Server.'));
    if (setup.token === null || init.headers?.['X-Setup-Token'] === setup.token) {
      return Promise.resolve(STATUS);
    }
    return Promise.resolve({
      authorized: false,
      claimed: false,
      claimable: false,
      loginConfigured: false,
    });
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('SetupPage', () => {
  afterEach(() => {
    setup.token = null;
    setup.calls = [];
    sessionStorage.clear();
  });

  it('opens with the setup token typed in – sent as a header, kept for the tab, never in the URL', async () => {
    setup.token = 'the-token';
    const client = renderPage();
    const field = await screen.findByLabelText('Setup-Token');
    expect(setup.calls[0]?.headers).toEqual({});

    await userEvent.type(field, 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText(/Der Setup-Token stimmt nicht/)).toBeTruthy();

    await userEvent.clear(screen.getByLabelText('Setup-Token'));
    await userEvent.type(screen.getByLabelText('Setup-Token'), 'the-token');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeTruthy();
    expect(setup.calls.at(-1)?.headers).toEqual({ 'X-Setup-Token': 'the-token' });
    expect(sessionStorage.getItem('slider-setup-token')).toBe('the-token');
    expect(window.location.href).not.toContain('the-token');
    client.clear();
  });

  it('keeps the form and what was typed when a refetch fails, and offers a retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SetupPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const editable = async () =>
      (await screen.findAllByRole('textbox')).find(
        (input) => !(input as HTMLInputElement).readOnly,
      ) as HTMLInputElement;
    await userEvent.type(await editable(), 'getippt');

    setup.fail = true;
    await act(() => client.refetchQueries({ queryKey: ['setup'] }));
    expect(await screen.findByText('Keine Verbindung zum Server.')).toBeTruthy();
    expect((await editable()).value).toBe('getippt');

    setup.fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(screen.queryByText('Keine Verbindung zum Server.')).toBeNull());
    expect((await editable()).value).toBe('getippt');
    client.clear();
  });
});
