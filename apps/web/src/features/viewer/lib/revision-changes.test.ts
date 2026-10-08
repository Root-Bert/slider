import { toSyncSummary, type SyncCounts } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import type { Revision } from '@slider/shared';
import {
  bannerSyncError,
  commentChangesText,
  currentRevision,
  oldestOpenComment,
  revisionsToCheck,
  isChangedSinceComment,
  isLoginError,
  lastCheckedLabel,
  revisionBannerText,
  slideBadge,
  slideBadges,
  slideModifiedAt,
  summaryChips,
  syncResultMessage,
} from './revision-changes';
import { comment, slide } from './test-fixtures';

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

describe('changed since comment', () => {
  const slides = [
    slide('s1', 0, { change: { status: 'modified', moved: false, confidence: 1 } }),
    slide('s2', 1, { change: { status: 'moved', moved: true, confidence: 1 } }),
    slide('s3', 2, { change: null }),
  ];
  const modifiedAt = slideModifiedAt(slides, '2026-10-05T12:00:00.000Z');

  it('only counts slides whose content changed', () => {
    expect([...modifiedAt.keys()]).toEqual(['s1']);
    expect(slideModifiedAt(slides, null).size).toBe(0);
  });

  it('remembers changes of earlier revisions', () => {
    const history = [
      {
        createdAt: '2026-10-03T12:00:00.000Z',
        slides: [{ slideId: 's3', status: 'modified' as const }],
      },
      {
        createdAt: '2026-10-04T12:00:00.000Z',
        slides: [{ slideId: 's1', status: 'modified' as const }],
      },
      {
        createdAt: '2026-10-04T13:00:00.000Z',
        slides: [{ slideId: 's3', status: 'moved' as const }],
      },
    ];
    const result = slideModifiedAt(slides, '2026-10-05T12:00:00.000Z', history);
    // s3 changed in an earlier revision; the later move-only revision doesn't clear it.
    expect(result.get('s3')).toBe('2026-10-03T12:00:00.000Z');
    // The newest change wins.
    expect(result.get('s1')).toBe('2026-10-05T12:00:00.000Z');
    expect(result.has('s2')).toBe(false);
    // A later revision that left the slide alone keeps the flag of a comment written before.
    const onS3 = comment({ slideId: 's3', createdAt: '2026-10-02T09:00:00.000Z' });
    expect(isChangedSinceComment(onS3, result)).toBe(true);
  });

  it('only fetches revisions that can still flag a comment', () => {
    const revision = (
      number: number,
      createdAt: string,
      extra: Partial<Revision> = {},
    ): Revision => ({
      id: `r${number}`,
      number,
      createdAt,
      status: 'ready',
      trigger: 'upload',
      isCurrent: false,
      summary: null,
      ...extra,
    });
    const revisions = [
      revision(5, '2026-10-06T00:00:00.000Z', { isCurrent: true }),
      revision(4, '2026-10-05T00:00:00.000Z', { status: 'failed' }),
      revision(3, '2026-10-04T00:00:00.000Z'),
      revision(2, '2026-10-02T00:00:00.000Z'),
      revision(1, '2026-10-01T00:00:00.000Z'),
    ];
    expect(revisionsToCheck(revisions, '2026-10-03T00:00:00.000Z').map((r) => r.id)).toEqual([
      'r3',
    ]);
    expect(revisionsToCheck(revisions, '2026-09-01T00:00:00.000Z').map((r) => r.id)).toEqual([
      'r3',
      'r2',
    ]);
    expect(revisionsToCheck(revisions, null)).toEqual([]);
    expect(revisionsToCheck(undefined, '2026-09-01T00:00:00.000Z')).toEqual([]);
  });

  it('finds the oldest open root comment on a slide', () => {
    expect(
      oldestOpenComment([
        comment({ slideId: 's1', createdAt: '2026-10-03T00:00:00.000Z' }),
        comment({ slideId: 's1', createdAt: '2026-10-01T00:00:00.000Z', status: 'done' }),
        comment({ slideId: 's1', createdAt: '2026-10-01T00:00:00.000Z', parentId: 'x' }),
        comment({ slideId: null, createdAt: '2026-09-01T00:00:00.000Z' }),
        comment({ slideId: 's2', createdAt: '2026-10-02T00:00:00.000Z' }),
      ]),
    ).toBe('2026-10-02T00:00:00.000Z');
    expect(oldestOpenComment([])).toBeNull();
  });

  it('flags open root comments written before the change', () => {
    const before = comment({ slideId: 's1', createdAt: '2026-10-01T09:00:00.000Z' });
    const after = comment({ slideId: 's1', createdAt: '2026-10-06T09:00:00.000Z' });
    expect(isChangedSinceComment(before, modifiedAt)).toBe(true);
    expect(isChangedSinceComment(after, modifiedAt)).toBe(false);
  });

  it('ignores done threads, replies, moved slides and gap comments', () => {
    const base = { createdAt: '2026-10-01T09:00:00.000Z' };
    expect(
      isChangedSinceComment(comment({ ...base, slideId: 's1', status: 'done' }), modifiedAt),
    ).toBe(false);
    expect(
      isChangedSinceComment(comment({ ...base, slideId: 's1', parentId: 'root' }), modifiedAt),
    ).toBe(false);
    expect(isChangedSinceComment(comment({ ...base, slideId: 's2' }), modifiedAt)).toBe(false);
    expect(isChangedSinceComment(comment({ ...base, slideId: null }), modifiedAt)).toBe(false);
    expect(
      isChangedSinceComment(
        comment({ ...base, slideId: 's1', source: 'pptx', sourceStatus: 'removed_in_pptx' }),
        modifiedAt,
      ),
    ).toBe(false);
  });
});

describe('copy', () => {
  it('builds the banner headline from the summary', () => {
    const summary = toSyncSummary(counts({ slidesModified: 3, slidesNew: 1 }));
    expect(revisionBannerText(summary)).toBe('Neue Version geladen · 3 Folien geändert, 1 neu');
    expect(revisionBannerText(null)).toBe('Neue Version geladen');
  });

  it('turns the slide counts into coloured chips and the comments into a line', () => {
    const summary = toSyncSummary(
      counts({ slidesNew: 2, slidesModified: 3, slidesMoved: 1, slidesDeleted: 1, commentsNew: 1 }),
    );
    expect(summaryChips(summary)).toEqual([
      { tone: 'success', label: '2 neu' },
      { tone: 'warning', label: '3 geändert' },
      { tone: 'info', label: '1 verschoben' },
      { tone: 'danger', label: '1 gelöscht' },
    ]);
    expect(commentChangesText(summary)).toBe('1 neuer Kommentar');
    const onlyComments = toSyncSummary(counts({ commentsRemoved: 3, commentsUpdated: 1 }));
    expect(summaryChips(onlyComments)).toEqual([]);
    expect(commentChangesText(onlyComments)).toBe('1 Kommentar geändert · 3 Kommentare entfernt');
    expect(commentChangesText(toSyncSummary(counts({ slidesNew: 1 })))).toBeNull();
    expect(summaryChips(null)).toEqual([]);
    expect(commentChangesText(null)).toBeNull();
  });

  it('words the result of "Neu laden"', () => {
    expect(syncResultMessage({ status: 'unchanged' })).toEqual({
      text: 'Keine Änderungen',
      tone: 'neutral',
    });
    const summary = toSyncSummary(counts({ commentsNew: 1 }));
    expect(syncResultMessage({ status: 'updated', summary }).text).toBe(
      'Neue Version geladen · 1 neuer Kommentar aus PowerPoint',
    );
    expect(syncResultMessage({ status: 'queued' }).text).toContain('wird übernommen');
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

  it('says when the source was last checked', () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    expect(lastCheckedLabel({ lastCheckedAt: '2026-10-05T11:55:00.000Z' }, now)).toBe(
      'Zuletzt geprüft vor 5 Min.',
    );
    expect(lastCheckedLabel({ lastCheckedAt: '2026-10-05T11:59:50.000Z' }, now)).toBe(
      'Gerade eben geprüft',
    );
    expect(lastCheckedLabel({ lastCheckedAt: null }, now)).toBe('Noch nicht geprüft');
  });

  it('knows which errors a new sign-in fixes', () => {
    expect(isLoginError('auth_required')).toBe(true);
    expect(isLoginError('consent_required')).toBe(true);
    expect(isLoginError('unreachable')).toBe(false);
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
