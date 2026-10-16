import type { DeckSync, SyncError } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionBanners } from './RevisionBanners';

const revision = { sync: null as DeckSync | null, isLinked: true, revisionNumber: 4 };
const viewer = { deck: { id: 'deck-1' }, canManage: true };
const dismissed = new Map<string, string>();

vi.mock('../state/revision-data', () => ({ useRevisionData: () => revision }));
vi.mock('../state/viewer-data', () => ({ useViewerData: () => viewer }));
vi.mock('./lib/seen-revisions', () => ({
  isSyncErrorDismissed: (deckId: string, at: string) => dismissed.get(deckId) === at,
  dismissSyncError: (deckId: string, at: string) => dismissed.set(deckId, at),
}));

const syncWith = (patch: Partial<DeckSync>) => ({ ...patch }) as DeckSync;
const error = (patch: Partial<SyncError> = {}): SyncError =>
  ({
    code: 'auth_required',
    message: 'Bitte melde dich erneut an.',
    at: '2026-10-16T10:00:00.000Z',
    loginUrl: 'https://login.example/start',
    ...patch,
  }) as SyncError;

beforeEach(() => {
  revision.sync = null;
  revision.isLinked = true;
  viewer.canManage = true;
  dismissed.clear();
});

// Also when an assertion fails, so a stubbed `location` never leaks into the next test.
afterEach(() => vi.unstubAllGlobals());

describe('RevisionBanners', () => {
  it('renders nothing without a pending change or error', () => {
    const { container } = render(<RevisionBanners />);
    expect(container.innerHTML).toBe('');
  });

  it('says a pending change is being taken over', () => {
    revision.sync = syncWith({ pending: true });
    render(<RevisionBanners />);
    const banner = screen.getByText(/Änderung erkannt/);
    expect(banner.tagName).toBe('SECTION');
    expect(banner.getAttribute('role')).toBe('status');
  });

  it('shows a login error with its action, and the error wins over pending', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    revision.sync = syncWith({ pending: true, lastSyncError: error() });
    render(<RevisionBanners />);
    expect(screen.queryByText(/Änderung erkannt/)).toBeNull();
    const banner = screen.getByRole('alert', { name: 'Anmeldung bei Microsoft abgelaufen' });
    expect(banner.textContent).toContain('Bitte melde dich erneut an.');
    expect(banner.textContent).toContain('Du siehst weiterhin Version 4');
    await userEvent.click(screen.getByRole('button', { name: 'Mit Microsoft anmelden' }));
    expect(assign).toHaveBeenCalledWith('https://login.example/start');
  });

  it('offers no sign-in to viewers who cannot manage the deck', () => {
    viewer.canManage = false;
    revision.sync = syncWith({ lastSyncError: error() });
    render(<RevisionBanners />);
    expect(screen.queryByRole('button', { name: /anmelden/i })).toBeNull();
  });

  it('expands the details on phones', async () => {
    revision.sync = syncWith({ lastSyncError: error({ code: 'not_found', loginUrl: undefined }) });
    render(<RevisionBanners />);
    const toggle = screen.getByRole('button', { name: /Details anzeigen/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Details ausblenden');
  });

  it('remembers a dismissed error until a newer one arrives', async () => {
    revision.sync = syncWith({ lastSyncError: error() });
    const { rerender } = render(<RevisionBanners />);
    await userEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(dismissed.get('deck-1')).toBe('2026-10-16T10:00:00.000Z');

    revision.sync = syncWith({ lastSyncError: error({ at: '2026-10-16T11:00:00.000Z' }) });
    rerender(<RevisionBanners />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('hides an error once a later sync succeeded, and for uploads', () => {
    revision.sync = syncWith({ lastSyncError: error(), lastSyncAt: '2026-10-16T12:00:00.000Z' });
    const { container, rerender } = render(<RevisionBanners />);
    expect(container.innerHTML).toBe('');
    revision.sync = syncWith({ lastSyncError: error() });
    revision.isLinked = false;
    rerender(<RevisionBanners />);
    expect(container.innerHTML).toBe('');
  });
});
