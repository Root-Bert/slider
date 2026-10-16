import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoAccessInfo } from '../hooks/useLinkImport';
import { NoAccessCard } from './NoAccessCard';

const TITLE = 'Wir können diesen Link nicht öffnen';

function setup(info: Partial<NoAccessInfo> = {}) {
  const onUploadInstead = vi.fn();
  const onSignIn = vi.fn();
  render(
    <NoAccessCard
      info={{ host: 'acme.sharepoint.com', kind: 'login', message: 'Nachricht', ...info }}
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
    expect(screen.getByText(/acme\.sharepoint\.com · Nur Personen/)).toBeTruthy();
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
