import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthProviders } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { LoginOptions } from './LoginOptions';

const passkeys = vi.hoisted(() => ({ supported: false }));
vi.mock('@/lib/passkeys', () => ({
  passkeysSupported: () => passkeys.supported,
  isPasskeyCancel: () => false,
  passkeyErrorMessage: (error: Error) => error.message,
  signInWithPasskey: vi.fn(),
}));

const sso = vi.hoisted(() => ({ discover: vi.fn(), startEmail: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  discoverSso: sso.discover,
  startEmailLogin: sso.startEmail,
}));

const config = {
  providers: [{ id: 'google', label: 'Mit Google anmelden', loginUrl: '/api/auth/google/login' }],
  passkeys: false,
} as unknown as AuthProviders;

describe('LoginOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sso.startEmail.mockReset();
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

  it('e-mail (BER-168): the address gets a login link, and can ask for it again', async () => {
    sso.startEmail.mockResolvedValue(undefined);
    render(<LoginOptions config={{ ...config, emailLogin: true }} returnTo="/neu" />);
    const send = screen.getByRole('button', { name: 'Mit E-Mail fortfahren' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), ' lena@firma.de ');
    await userEvent.click(send);
    expect(sso.startEmail).toHaveBeenCalledWith({ email: 'lena@firma.de', returnTo: '/neu' });
    expect(await screen.findByText('Schau in dein Postfach')).toBeTruthy();
    expect(screen.getByText('lena@firma.de')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Erneut senden/ }));
    expect(sso.startEmail).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Andere Adresse' }));
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeTruthy();
  });

  it('e-mail with company logins: the same field finds the company’s, else sends the link', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    sso.startEmail.mockResolvedValue(undefined);
    sso.discover.mockResolvedValueOnce({
      loginUrl: '/api/auth/sso/login?organisation=w1',
      organisation: 'Firma',
    });
    const { unmount } = render(
      <LoginOptions config={{ ...config, sso: true, emailLogin: true }} returnTo="/" />,
    );
    // No separate company-login button: the e-mail field does both.
    expect(screen.queryByRole('button', { name: /Mit Firmen-Login anmelden/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@firma.de');
    await userEvent.click(screen.getByRole('button', { name: 'Mit E-Mail fortfahren' }));
    expect(assign).toHaveBeenCalledWith('/api/auth/sso/login?organisation=w1&returnTo=%2F');
    expect(sso.startEmail).not.toHaveBeenCalled();
    unmount();

    sso.discover.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Kein Firmen-Login.'));
    render(<LoginOptions config={{ ...config, sso: true, emailLogin: true }} returnTo="/" />);
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'lena@privat.de');
    await userEvent.click(screen.getByRole('button', { name: 'Mit E-Mail fortfahren' }));
    expect(sso.startEmail).toHaveBeenCalledWith({ email: 'lena@privat.de', returnTo: '/' });
  });

  it('resending the link asks for no company login again', async () => {
    sso.startEmail.mockResolvedValue(undefined);
    sso.discover
      .mockReset()
      .mockRejectedValue(new ApiError(404, 'not_found', 'Kein Firmen-Login.'));
    render(<LoginOptions config={{ ...config, sso: true, emailLogin: true }} returnTo="/" />);
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'lena@privat.de');
    await userEvent.click(screen.getByRole('button', { name: 'Mit E-Mail fortfahren' }));
    await userEvent.click(await screen.findByRole('button', { name: /Erneut senden/ }));
    expect(sso.startEmail).toHaveBeenCalledTimes(2);
    expect(sso.discover).toHaveBeenCalledTimes(1);
  });

  it('back from the company login with the back button: the field is usable again', async () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    sso.discover.mockReset().mockResolvedValue({
      loginUrl: '/api/auth/sso/login?organisation=w1',
      organisation: 'Firma',
    });
    render(<LoginOptions config={{ ...config, sso: true, emailLogin: true }} returnTo="/" />);
    await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@firma.de');
    const submit = screen.getByRole('button', { name: 'Mit E-Mail fortfahren' });
    await userEvent.click(submit);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    expect(submit.getAttribute('aria-busy')).toBeNull();
  });

  it('no company login button without one on the instance', () => {
    render(<LoginOptions config={config} returnTo="/" />);
    expect(screen.queryByRole('button', { name: /Firmen-Login/ })).toBeNull();
  });
});
