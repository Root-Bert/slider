import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoAccessInfo } from '../hooks/useLinkImport';
import { NoAccessCard } from './NoAccessCard';

const TITLE = 'Wir können diesen Link nicht öffnen';

function setup(info: Partial<NoAccessInfo> = {}, connected = false) {
  const onUploadInstead = vi.fn();
  const onSignIn = vi.fn();
  render(
    <NoAccessCard
      info={{ host: 'acme.sharepoint.com', kind: 'login', message: 'Nachricht', ...info }}
      connected={connected}
      onSignIn={onSignIn}
      onUploadInstead={onUploadInstead}
    />,
  );
  return { onUploadInstead, onSignIn };
}

describe('NoAccessCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a region named by its h2, with the host chip and the help link', () => {
    setup({ loginUrl: '/api/login' });
    expect(screen.getByRole('region', { name: TITLE })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: TITLE })).toBeTruthy();
    expect(screen.getByText(/acme\.sharepoint\.com \| Nur Personen/)).toBeTruthy();
    const help = screen.getByRole('link', { name: /Link-Freigabe ändern/ });
    expect(help.getAttribute('target')).toBe('_blank');
    expect(help.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('login: the two-line copy and "Mit Microsoft anmelden" signs in', async () => {
    const { onSignIn } = setup({ loginUrl: '/api/login' });
    expect(screen.getByText(/nur für deine Organisation freigegeben/)).toBeTruthy();
    expect(screen.queryByText('Nachricht')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mit Microsoft anmelden' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('with a Microsoft account connected, the sign-in connects another one', async () => {
    const { onSignIn } = setup({ loginUrl: '/api/login' }, true);
    await userEvent.click(
      screen.getByRole('button', { name: 'Weiteres Microsoft-Konto verbinden' }),
    );
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('forbidden: none of my accounts may open it – connect another one', () => {
    setup(
      { kind: 'forbidden', message: 'Keins deiner Konten hat Zugriff.', loginUrl: '/api/login' },
      true,
    );
    expect(screen.getByText('Keins deiner Konten hat Zugriff.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weiteres Microsoft-Konto verbinden' })).toBeTruthy();
  });

  it('not configured: the sign-in is disabled and explains why', () => {
    setup({ kind: 'not_configured', message: 'Nicht eingerichtet.' });
    const button = screen.getByRole('button', { name: 'Mit Microsoft anmelden' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.parentElement!.getAttribute('title')).toBe(
      'Microsoft-Anmeldung ist nicht eingerichtet',
    );
    expect(screen.getByText('Nicht eingerichtet.')).toBeTruthy();
  });

  it('consent: offers "Erneut anmelden" instead', () => {
    setup({ kind: 'consent', message: 'Admin-Zustimmung fehlt.', loginUrl: '/api/login' });
    expect(screen.getByRole('button', { name: 'Erneut anmelden' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mit Microsoft anmelden' })).toBeNull();
  });

  it('"Stattdessen PPTX hochladen" hands over to the upload', async () => {
    const { onUploadInstead } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Stattdessen PPTX hochladen' }));
    expect(onUploadInstead).toHaveBeenCalledOnce();
  });
});

describe('NoAccessCard for a Nextcloud file (BER-135)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects the Nextcloud in a popup, then imports the link again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const popup = { location: { href: '' }, opener: {}, closed: false, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url);
        const body = url.endsWith('/poll')
          ? {
              status: 'done',
              connection: {
                id: 'c1',
                server: 'https://cloud.example.de',
                account: 'robert',
                createdAt: '2026-10-18T10:00:00.000Z',
                lastUsedAt: null,
                deckCount: 0,
                needsReconnect: false,
              },
            }
          : { id: 'flow-1', loginUrl: 'https://cloud.example.de/login/v2/flow/abc' };
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const onNextcloudConnected = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoAccessCard
          info={{
            host: 'cloud.example.de',
            kind: 'nextcloud',
            message: 'Verbinde dein Konto.',
            nextcloudServer: 'https://cloud.example.de',
          }}
          onSignIn={vi.fn()}
          onNextcloudConnected={onNextcloudConnected}
          onUploadInstead={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/cloud\.example\.de \| Nur mit deinem Nextcloud-Konto/)).toBeTruthy();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Mit Nextcloud verbinden' }));
    // The popup opens in the click; it never gets a handle on Slider.
    expect(popup.opener).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(popup.location.href).toBe('https://cloud.example.de/login/v2/flow/abc');
    expect(requests).toEqual(['/api/nextcloud/login', '/api/nextcloud/login/flow-1/poll']);
    expect(onNextcloudConnected).toHaveBeenCalledOnce();
    expect(popup.close).toHaveBeenCalled();
  });

  const renderNextcloud = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoAccessCard
          info={{
            host: 'cloud.example.de',
            kind: 'nextcloud',
            message: 'Verbinde dein Konto.',
            nextcloudServer: 'https://cloud.example.de',
          }}
          onSignIn={vi.fn()}
          onUploadInstead={vi.fn()}
        />
      </QueryClientProvider>,
    );

  it('says so when the popup is blocked, instead of waiting for a login nobody sees', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null),
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderNextcloud();
    const button = screen.getByRole('button', { name: 'Mit Nextcloud verbinden' });
    await userEvent.click(button);
    expect(screen.getByText(/Anmeldefenster wurde blockiert/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('can cancel the wait for the login', async () => {
    const popup = { location: { href: '' }, opener: {}, closed: false, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderNextcloud();
    const button = screen.getByRole('button', { name: 'Mit Nextcloud verbinden' });
    await userEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
  });

  it('google: picks the linked file in Google Drive (BER-119)', async () => {
    const onPickGoogle = vi.fn();
    render(
      <NoAccessCard
        info={{
          host: 'docs.google.com',
          kind: 'google',
          message: 'Wähle sie einmal in Google aus.',
          googleFileId: '1AbCdEfGhIjKlMn',
        }}
        onSignIn={vi.fn()}
        onPickGoogle={onPickGoogle}
        onUploadInstead={vi.fn()}
      />,
    );
    expect(screen.getByText(/docs\.google\.com \| Nur mit deinem Google-Konto/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /In Google Drive auswählen/ }));
    expect(onPickGoogle).toHaveBeenCalledWith('1AbCdEfGhIjKlMn');
  });
});
