import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SETUP_KEYS, type SetupField, type SetupKey, type SetupStatus } from '@slider/shared';
import { Component as SetupPage } from './SetupPage';

const EMPTY: SetupField = { source: null, value: null, set: false };
const STATUS: SetupStatus = {
  authorized: true,
  hasAccount: true,
  loginConfigured: true,
  settings: {
    url: 'https://slider.firma.de',
    restart: 'automatic',
    redirectUris: {
      microsoft: 'https://slider.firma.de/api/auth/microsoft/callback',
      google: 'https://slider.firma.de/api/auth/google/callback',
      oidc: 'https://slider.firma.de/api/auth/oidc/callback',
    },
    fields: Object.fromEntries(SETUP_KEYS.map((key) => [key, EMPTY])) as Record<
      SetupKey,
      SetupField
    >,
  },
};

const setup = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/api-client', () => ({
  apiRequest: () =>
    setup.fail
      ? Promise.reject(new Error('Keine Verbindung zum Server.'))
      : Promise.resolve(STATUS),
}));

describe('SetupPage', () => {
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
