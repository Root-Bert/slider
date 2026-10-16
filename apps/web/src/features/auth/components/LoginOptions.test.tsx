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
});
