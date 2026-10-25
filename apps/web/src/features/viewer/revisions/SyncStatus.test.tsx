import type { DeckSync, SyncError } from '@slider/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';

const revision = { sync: null as DeckSync | null, isLinked: true, revisionNumber: 4 };
const viewer = { deck: { id: 'deck-1', workspaceId: 'w1' }, canManage: true };
const me = { data: { workspaces: [{ id: 'w1', role: 'admin' }] } };

vi.mock('../state/revision-data', () => ({ useRevisionData: () => revision }));
vi.mock('../state/viewer-data', () => ({ useViewerData: () => viewer }));
vi.mock('@/lib/api', () => ({ useMe: () => me }));

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
  me.data.workspaces = [{ id: 'w1', role: 'admin' }];
});

// Also when an assertion fails, so a stubbed `location` never leaks into the next test.
afterEach(() => vi.unstubAllGlobals());

describe('SyncStatus', () => {
  it('renders nothing without a pending change or error', () => {
    const { container } = render(<SyncStatus />);
    expect(container.innerHTML).toBe('');
  });

  it('is a small spinner while a change is being taken over', () => {
    revision.sync = syncWith({ pending: true });
    render(<SyncStatus />);
    screen.getByRole('status', { name: /Änderung erkannt/ });
    expect(screen.getByRole('tooltip').textContent).toContain('wird übernommen');
  });

  it('is an icon whose popover tells the error and offers the sign-in; the error wins over pending', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    revision.sync = syncWith({ pending: true, lastSyncError: error() });
    render(<SyncStatus />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: 'Anmeldung bei Microsoft abgelaufen' }),
    );
    const panel = screen.getByRole('dialog', { name: 'Anmeldung bei Microsoft abgelaufen' });
    expect(panel.textContent).toContain('Bitte melde dich erneut an.');
    expect(panel.textContent).toContain('Du siehst weiterhin Version 4');
    await userEvent.click(screen.getByRole('button', { name: 'Mit Microsoft anmelden' }));
    expect(assign).toHaveBeenCalledWith('https://login.example/start');
  });

  it('names Nextcloud when the owner connects it again', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    revision.sync = syncWith({ lastSyncError: error({ loginUrl: '/konto' }) });
    render(<SyncStatus />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Anmeldung bei Nextcloud abgelaufen' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nextcloud verbinden' }));
    expect(assign).toHaveBeenCalledWith('/konto');
  });

  it('offers no sign-in to viewers who cannot manage the deck', async () => {
    viewer.canManage = false;
    revision.sync = syncWith({ lastSyncError: error() });
    render(<SyncStatus />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Anmeldung bei Microsoft abgelaufen' }),
    );
    screen.getByRole('dialog');
    expect(screen.queryByRole('button', { name: /anmelden/i })).toBeNull();
  });

  it('closes the popover on Escape', async () => {
    revision.sync = syncWith({ lastSyncError: error({ code: 'not_found', loginUrl: undefined }) });
    render(<SyncStatus />);
    await userEvent.click(screen.getByRole('button', { name: 'Präsentation nicht mehr gefunden' }));
    screen.getByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('also shows an unreachable source', async () => {
    revision.sync = syncWith({
      lastSyncError: error({
        code: 'unreachable',
        message: 'Die Quelle ist gerade nicht erreichbar.',
        loginUrl: undefined,
      }),
    });
    render(<SyncStatus />);
    await userEvent.click(screen.getByRole('button', { name: 'Quelle gerade nicht erreichbar' }));
    expect(screen.getByRole('dialog').textContent).toContain('Du siehst weiterhin Version 4');
  });

  it('hides an error once a later sync succeeded, and for uploads', () => {
    revision.sync = syncWith({ lastSyncError: error(), lastSyncAt: '2026-10-16T12:00:00.000Z' });
    const { container, rerender } = render(<SyncStatus />);
    expect(container.innerHTML).toBe('');
    revision.sync = syncWith({ lastSyncError: error() });
    revision.isLinked = false;
    rerender(<SyncStatus />);
    expect(container.innerHTML).toBe('');
  });

  it('says the storage is full, and leads admins to "Nutzung"', async () => {
    const storageFull = error({
      code: 'storage_full',
      message:
        'Speicher voll – neue Versionen aus OneDrive werden erst wieder übernommen, wenn Platz frei ist.',
      loginUrl: undefined,
    });
    revision.sync = syncWith({ lastSyncError: storageFull });
    const { unmount } = render(<SyncStatus />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Speicher des Workspace voll' }));
    expect(screen.getByRole('dialog').textContent).toContain('neue Versionen aus OneDrive');
    expect(screen.getByRole('link', { name: 'Speicher verwalten' }).getAttribute('href')).toBe(
      '/nutzung?workspace=w1',
    );
    unmount();

    // Members only read why.
    me.data.workspaces = [{ id: 'w1', role: 'member' }];
    render(<SyncStatus />, { wrapper: MemoryRouter });
    await userEvent.click(screen.getByRole('button', { name: 'Speicher des Workspace voll' }));
    screen.getByRole('dialog');
    expect(screen.queryByRole('link', { name: 'Speicher verwalten' })).toBeNull();
  });
});
