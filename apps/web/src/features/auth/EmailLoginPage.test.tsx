import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { Component as EmailLoginPage } from './EmailLoginPage';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), register: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmEmailLogin: mocks.confirm,
}));
vi.mock('@/lib/passkeys', () => ({
  passkeysSupported: () => true,
  isPasskeyCancel: () => false,
  passkeyErrorMessage: (error: Error) => error.message,
  registerPasskey: mocks.register,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/anmelden/tok-123']}>
        <Routes>
          <Route path="/anmelden/:token" element={<EmailLoginPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmailLoginPage', () => {
  // The legal links below the card ask for the instance's texts.
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.confirm.mockReset();
    mocks.register.mockReset();
  });

  it('signs in by button, never on opening (mail scanners open links)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mocks.confirm.mockResolvedValue({ redirectTo: '/neu', newAccount: false });
    renderPage();
    expect(mocks.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(mocks.confirm).toHaveBeenCalledWith('tok-123');
    expect(assign).toHaveBeenCalledWith('/neu');
  });

  it('a new account sets its name and adds a passkey before going on', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    mocks.confirm.mockResolvedValue({ redirectTo: '/', newAccount: true });
    mocks.register.mockResolvedValue({ id: 'p1' });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText('Dein Konto ist da')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Passkey anlegen/ }));
    expect(await screen.findByText('Passkey angelegt')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Dein Name'), 'Lena Berg');
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(patch).toHaveBeenCalledWith('/me', { name: 'Lena Berg' });
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('says why a link does not work', async () => {
    mocks.confirm.mockRejectedValue(new Error('Dieser Link ist ungültig oder abgelaufen.'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText(/Dieser Link ist ungültig oder abgelaufen\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toBeTruthy();
  });
});
