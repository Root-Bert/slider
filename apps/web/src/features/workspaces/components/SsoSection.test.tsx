import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Workspace, WorkspaceRole, WorkspaceSso } from '@slider/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { billingFixture } from '@/test/workspace';
import { SsoSection } from './SsoSection';

const api = vi.hoisted(() => ({
  sso: { data: undefined as WorkspaceSso | undefined },
  save: vi.fn(),
  remove: vi.fn(),
  removeError: null as Error | null,
  enabledWith: undefined as boolean | undefined,
}));

vi.mock('@/lib/api', () => ({
  useWorkspaceSso: (_id: string, enabled: boolean) => {
    api.enabledWith = enabled;
    return api.sso;
  },
  useSaveWorkspaceSso: () => ({ mutate: api.save, isPending: false, variables: undefined }),
  useDeleteWorkspaceSso: () => ({
    mutate: api.remove,
    reset: vi.fn(),
    isPending: false,
    error: api.removeError,
  }),
}));

const workspace = (role: WorkspaceRole = 'admin', joinDomain: string | null = 'firma.de') =>
  ({
    id: 'w1',
    name: 'Firma',
    role,
    plan: 'paid',
    billing: billingFixture(),
    joinDomain,
  }) as unknown as Workspace;

const sso = (patch: Partial<WorkspaceSso> = {}): WorkspaceSso => ({
  configured: false,
  issuer: null,
  clientId: null,
  hasSecret: false,
  redirectUri: 'https://slider.firma.de/api/auth/sso/callback',
  domain: 'firma.de',
  dnsRecord: null,
  verified: false,
  available: true,
  active: false,
  ...patch,
});

const notify = vi.fn();

describe('SsoSection (BER-162)', () => {
  beforeEach(() => {
    api.save.mockReset();
    api.removeError = null;
    api.sso = { data: sso() };
  });

  it('is for admins of instances that open workspaces to domains only', () => {
    const { container, rerender } = render(
      <SsoSection workspace={workspace('member')} enabled onNotify={notify} />,
    );
    expect(container.textContent).toBe('');
    rerender(<SsoSection workspace={workspace()} enabled={false} onNotify={notify} />);
    expect(container.textContent).toBe('');
  });

  it('asks to open the workspace to the domain first', () => {
    render(<SsoSection workspace={workspace('admin', null)} enabled onNotify={notify} />);
    expect(screen.getByText(/Öffne den Workspace zuerst/)).toBeTruthy();
    expect(api.enabledWith).toBe(false);
  });

  it('shows the redirect URI and saves issuer, client ID and secret', async () => {
    render(<SsoSection workspace={workspace()} enabled onNotify={notify} />);
    expect(
      (screen.getByLabelText('Weiterleitungs-URI (genau so eintragen)') as HTMLInputElement).value,
    ).toBe('https://slider.firma.de/api/auth/sso/callback');
    const connect = screen.getByRole('button', { name: 'Verbinden' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    await userEvent.type(
      screen.getByLabelText('Issuer-URL'),
      'https://login.firma.de/realms/firma',
    );
    await userEvent.type(screen.getByLabelText('Client ID'), 'slider');
    await userEvent.type(screen.getByLabelText('Client Secret'), 'geheim');
    await userEvent.click(connect);
    expect(api.save).toHaveBeenCalledWith(
      { issuer: 'https://login.firma.de/realms/firma', clientId: 'slider', clientSecret: 'geheim' },
      expect.anything(),
    );
  });

  it('then asks for the DNS record and checks it; the saved secret may stay empty', async () => {
    api.sso = {
      data: sso({
        configured: true,
        issuer: 'https://login.firma.de/realms/firma',
        clientId: 'slider',
        hasSecret: true,
        dnsRecord: { name: '_slider-sso.firma.de', value: 'slider-sso=abc' },
      }),
    };
    render(<SsoSection workspace={workspace()} enabled onNotify={notify} />);
    expect(screen.getByText('Domain noch nicht bestätigt')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('_slider-sso.firma.de');
    expect((screen.getByLabelText('Wert') as HTMLInputElement).value).toBe('slider-sso=abc');
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    expect(api.save).toHaveBeenCalledWith('verify', expect.anything());
  });

  it('says in the remove dialog why removing failed, not in a toast behind it', async () => {
    api.removeError = new Error('Nicht erlaubt.');
    api.sso = {
      data: sso({
        configured: true,
        hasSecret: true,
        dnsRecord: { name: '_slider-sso.firma.de', value: 'slider-sso=abc' },
      }),
    };
    render(<SsoSection workspace={workspace()} enabled onNotify={notify} />);
    await userEvent.click(screen.getByRole('button', { name: 'Firmen-Login entfernen' }));
    expect(screen.getByRole('alert').textContent).toBe('Nicht erlaubt.');
  });

  it('points to the paid plan where SSO is not part of it', () => {
    api.sso = { data: sso({ available: false }) };
    render(<SsoSection workspace={workspace()} enabled onNotify={notify} />);
    expect(screen.getByText(/gibt es im Paid-Plan/)).toBeTruthy();
    expect(screen.queryByLabelText('Issuer-URL')).toBeNull();
  });

  it('says when it is active', () => {
    api.sso = {
      data: sso({
        configured: true,
        hasSecret: true,
        verified: true,
        active: true,
        dnsRecord: { name: '_slider-sso.firma.de', value: 'slider-sso=abc' },
      }),
    };
    render(<SsoSection workspace={workspace()} enabled onNotify={notify} />);
    expect(screen.getByText('Aktiv')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut prüfen' })).toBeTruthy();
  });
});
