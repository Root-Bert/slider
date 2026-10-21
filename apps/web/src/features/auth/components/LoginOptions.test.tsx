import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthProviders } from '@slider/shared';
import { LoginOptions } from './LoginOptions';

const passkeys = vi.hoisted(() => ({ supported: false }));
vi.mock('@/lib/passkeys', () => ({
  passkeysSupported: () => passkeys.supported,
  isPasskeyCancel: () => false,
  passkeyErrorMessage: (error: Error) => error.message,
  signInWithPasskey: vi.fn(),
}));

const sso = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  discoverSso: sso.discover,
}));

const config = {
  providers: [{ id: 'google', label: 'Mit Google anmelden', loginUrl: '/api/auth/google/login' }],
  passkeys: false,
} as unknown as AuthProviders;

describe('LoginOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    passkeys.supported = false;
  });

  it('still offers passkeys when every provider is switched off, and points to /einrichtung', () => {
    passkeys.supported = true;
    render(<LoginOptions config={{ ...config, providers: [] }} returnTo="/" />);
    expect(screen.getByText('Anmeldung nicht eingerichtet')).toBeTruthy();
    expect(screen.getByText('/einrichtung')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mit Passkey anmelden/ })).toBeTruthy();
  });

  it('a provider button is clickable again after Back from the identity provider (bfcache)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<LoginOptions config={config} returnTo="/" />);
    const button = screen.getByRole('button', { name: /Mit Google anmelden/ }) as HTMLButtonElement;
    await userEvent.click(button);
    expect(assign).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);

    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(event, 'persisted', { value: true });
      window.dispatchEvent(event);
    });
    expect(button.disabled).toBe(false);
  });

  it('any Nextcloud: the button asks for the address', async () => {
    render(
      <LoginOptions
        config={{
          ...config,
          providers: [
            { id: 'microsoft', label: 'Weiter mit Microsoft', kind: 'redirect', loginUrl: '/m' },
          ],
          nextcloudAnyServer: true,
        }}
        returnTo="/"
      />,
    );
    // Side by side the buttons name just the provider; the full label is their accessible name.
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Microsoft', 'Nextcloud']);
    await userEvent.click(screen.getByRole('button', { name: 'Weiter mit Nextcloud' }));
    expect(screen.getByLabelText('Adresse deiner Nextcloud')).toBeTruthy();
    // A short warning; the details behind "Mehr erfahren".
    await userEvent.click(screen.getByRole('button', { name: 'Mehr erfahren' }));
    expect(screen.getByRole('heading', { name: 'Niemals bestätigen, wenn …' })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Weiter$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('next to the organisation’s Nextcloud, other ones get a quiet way in', () => {
    render(
      <LoginOptions
        config={{
          ...config,
          providers: [
            { id: 'nextcloud', label: 'Weiter mit Nextcloud', kind: 'redirect', loginUrl: '/n' },
          ],
          nextcloudAnyServer: true,
        }}
        returnTo="/"
      />,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Weiter mit Nextcloud',
      'Mit einer anderen Nextcloud anmelden',
    ]);
  });

  it('company login (BER-162): the address finds the organisation’s provider', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    sso.discover.mockResolvedValueOnce({
      loginUrl: '/api/auth/sso/login?organisation=w1',
      organisation: 'Firma',
    });
    render(<LoginOptions config={{ ...config, sso: true }} returnTo="/decks" />);
    await userEvent.click(screen.getByRole('button', { name: /Mit Firmen-Login anmelden/ }));
    await userEvent.type(screen.getByLabelText('Deine Firmen-Adresse'), 'ben@firma.de');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(sso.discover).toHaveBeenCalledWith('ben@firma.de');
    expect(assign).toHaveBeenCalledWith('/api/auth/sso/login?organisation=w1&returnTo=%2Fdecks');
    const address = screen.getByLabelText('Deine Firmen-Adresse') as HTMLInputElement;
    expect(address.disabled).toBe(true);

    // Back from the provider (bfcache): the form can be used again.
    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(event, 'persisted', { value: true });
      window.dispatchEvent(event);
    });
    expect(address.disabled).toBe(false);
  });

  it('company login: says so when the address has none', async () => {
    sso.discover.mockRejectedValueOnce(new Error('Für diese Adresse gibt es keinen Firmen-Login.'));
    render(<LoginOptions config={{ ...config, sso: true }} returnTo="/" />);
    await userEvent.click(screen.getByRole('button', { name: /Mit Firmen-Login anmelden/ }));
    await userEvent.type(screen.getByLabelText('Deine Firmen-Adresse'), 'ben@gmail.com');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText('Für diese Adresse gibt es keinen Firmen-Login.')).toBeTruthy();
  });

  it('no company login button without one on the instance', () => {
    render(<LoginOptions config={config} returnTo="/" />);
    expect(screen.queryByRole('button', { name: /Firmen-Login/ })).toBeNull();
  });
});
