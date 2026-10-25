import { toSyncSummary, type SyncCounts } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  bannerSyncError,
  currentRevision,
  isLoginError,
  revisionNoticeText,
  slideBadge,
  slideBadges,
  syncErrorTitle,
  syncResultMessage,
  visibilityChange,
} from './revision-changes';
import { slide } from '../../lib/test-fixtures';

const counts = (overrides: Partial<SyncCounts> = {}): SyncCounts => ({
  slidesModified: 0,
  slidesNew: 0,
  slidesDeleted: 0,
  slidesMoved: 0,
  commentsNew: 0,
  commentsUpdated: 0,
  commentsRemoved: 0,
  ...overrides,
});

describe('slideBadge', () => {
  it('has no badge for unchanged slides and revision 1', () => {
    expect(slideBadge(null)).toBeNull();
    expect(slideBadge(undefined)).toBeNull();
    expect(slideBadge({ status: 'unchanged', moved: false, confidence: 1 })).toBeNull();
  });

  it('marks new slides', () => {
    const badge = slideBadge({ status: 'new', moved: false, confidence: 0 });
    expect(badge).toMatchObject({ kind: 'new', label: 'Neu', uncertain: false });
  });

  it('marks modified slides and shows a move next to it', () => {
    expect(slideBadge({ status: 'modified', moved: false, confidence: 0.9 })).toMatchObject({
      kind: 'modified',
      label: 'Geändert',
      moved: false,
      uncertain: false,
    });
    expect(slideBadge({ status: 'modified', moved: true, confidence: 0.9 })?.moved).toBe(true);
  });

  it('shows old and new position of a moved slide (1-based)', () => {
    const badge = slideBadge(
      { status: 'moved', moved: true, confidence: 1 },
      { position: 1, previousPosition: 3 },
    );
    expect(badge?.label).toBe('Verschoben 4→2');
    // Tiny chips (minimap, phones) only show the positions next to the ↔ icon.
    expect(badge?.short).toBe('4→2');
    expect(badge?.description).toContain('4 nach 2');
    expect(slideBadge({ status: 'moved', moved: true, confidence: 1 })?.label).toBe('Verschoben');
  });

  it('asks to check the matching when it is unsure', () => {
    const badge = slideBadge({ status: 'modified', moved: false, confidence: 0.5 });
    expect(badge?.uncertain).toBe(true);
    expect(badge?.description).toContain('Zuordnung prüfen');
    // A new slide was not matched at all, so there is nothing to check.
    expect(slideBadge({ status: 'new', moved: false, confidence: 0 })?.uncertain).toBe(false);
  });
});

describe('slideBadges', () => {
  it('prefers the diff (positions) and falls back to the slide change', () => {
    const slides = [
      slide('a', 0, { change: { status: 'moved', moved: true, confidence: 1 } }),
      slide('b', 1, { change: { status: 'unchanged', moved: false, confidence: 1 } }),
      slide('c', 2, { change: { status: 'new', moved: false, confidence: 0 } }),
    ];
    const diff = {
      slides: [
        {
          slideId: 'a',
          status: 'moved' as const,
          moved: true,
          confidence: 1,
          position: 0,
          previousPosition: 2,
          matchedBy: 'sldId' as const,
        },
      ],
    };
    const badges = slideBadges(slides, diff);
    expect([...badges.keys()]).toEqual(['a', 'c']);
    expect(badges.get('a')?.label).toBe('Verschoben 3→1');
    expect(slideBadges(slides, null).get('a')?.label).toBe('Verschoben');
  });
});

describe('copy', () => {
  it('builds the new-version notice from the summary', () => {
    const summary = toSyncSummary(counts({ slidesModified: 3, slidesNew: 1 }));
    expect(revisionNoticeText(5, summary)).toBe('V5 geladen | 3 Folien geändert, 1 neu');
    expect(revisionNoticeText(5, null)).toBe('V5 geladen');
  });

  it('words the result of a new upload', () => {
    expect(syncResultMessage({ status: 'unchanged' })).toEqual({
      text: 'Keine Änderungen',
      tone: 'neutral',
    });
    const summary = toSyncSummary(counts({ commentsNew: 1 }));
    // A new version is announced by the notice next to the button, not by a toast.
    expect(syncResultMessage({ status: 'updated', summary })).toBeNull();
    expect(syncResultMessage({ status: 'queued' })?.text).toContain('wird übernommen');
    const error = {
      code: 'auth_required' as const,
      message: 'Bitte melde dich erneut an.',
      at: '2026-10-05T12:00:00.000Z',
    };
    expect(syncResultMessage({ status: 'error', error })).toEqual({
      text: 'Bitte melde dich erneut an.',
      tone: 'danger',
    });
  });

  it('knows which errors a new sign-in fixes', () => {
    expect(isLoginError('auth_required')).toBe(true);
    expect(isLoginError('consent_required')).toBe(true);
    expect(isLoginError('unreachable')).toBe(false);
  });

  it('names the provider the sign-in goes to', () => {
    expect(syncErrorTitle('auth_required', 'https://login.example/start')).toBe(
      'Anmeldung bei Microsoft abgelaufen',
    );
    expect(syncErrorTitle('auth_required', '/konto?nextcloud=cloud.firma.de')).toBe(
      'Anmeldung bei Nextcloud abgelaufen',
    );
    expect(syncErrorTitle('storage_full')).toBe('Speicher des Workspace voll');
  });
});

describe('bannerSyncError', () => {
  const error = {
    code: 'parse_failed' as const,
    message: 'kaputt',
    at: '2026-10-05T12:00:00.000Z',
  };

  it('shows errors of link imports', () => {
    expect(bannerSyncError({ lastSyncError: error, lastSyncAt: null }, true)).toBe(error);
    expect(bannerSyncError({ lastSyncError: null, lastSyncAt: null }, true)).toBeNull();
    expect(bannerSyncError(null, true)).toBeNull();
  });

  it('never shows a failed upload of an uploaded deck as a banner', () => {
    expect(bannerSyncError({ lastSyncError: error, lastSyncAt: null }, false)).toBeNull();
  });

  it('drops errors older than the last successful update', () => {
    expect(
      bannerSyncError({ lastSyncError: error, lastSyncAt: '2026-10-05T13:00:00.000Z' }, true),
    ).toBeNull();
    expect(
      bannerSyncError({ lastSyncError: error, lastSyncAt: '2026-10-05T11:00:00.000Z' }, true),
    ).toBe(error);
  });
});

describe('currentRevision', () => {
  it('picks the current one from the list', () => {
    const revision = (number: number, isCurrent: boolean) => ({
      id: `r${number}`,
      number,
      createdAt: '2026-10-05T12:00:00.000Z',
      status: 'ready' as const,
      trigger: 'upload' as const,
      isCurrent,
      summary: null,
    });
    expect(currentRevision([revision(2, true), revision(1, false)])?.id).toBe('r2');
    expect(currentRevision(undefined)).toBeNull();
  });
});

describe('visibilityChange', () => {
  it('names hiding and showing apart from the content badge', () => {
    expect(visibilityChange({ hiddenChanged: 'hidden' })).toMatchObject({
      kind: 'hidden',
      label: 'Ausgeblendet',
    });
    expect(visibilityChange({ hiddenChanged: 'shown' })).toMatchObject({
      kind: 'shown',
      label: 'Wieder eingeblendet',
      description: 'In dieser Version wieder eingeblendet',
    });
  });

  it('is null when the visibility did not change (and in revision 1)', () => {
    expect(visibilityChange({})).toBeNull();
    expect(visibilityChange(null)).toBeNull();
    expect(visibilityChange(undefined)).toBeNull();
  });
});
