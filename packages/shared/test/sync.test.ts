import { describe, expect, it } from 'vitest';
import {
  commentSchema,
  deckSchema,
  deckStatusSchema,
  formatSyncSummary,
  revisionDiffSchema,
  slideSchema,
  syncResultSchema,
  type SyncCounts,
} from '../src';

const zero: SyncCounts = {
  slidesModified: 0,
  slidesNew: 0,
  slidesDeleted: 0,
  slidesMoved: 0,
  commentsNew: 0,
  commentsUpdated: 0,
  commentsRemoved: 0,
};

describe('formatSyncSummary', () => {
  it('lists changes in a fixed order', () => {
    expect(
      formatSyncSummary({
        ...zero,
        slidesModified: 3,
        slidesNew: 1,
        slidesDeleted: 1,
        commentsNew: 5,
      }),
    ).toBe('3 Folien geändert, 1 neu, 1 gelöscht, 5 neue Kommentare aus PowerPoint');
  });

  it('uses the singular for one', () => {
    expect(formatSyncSummary({ ...zero, slidesModified: 1 })).toBe('1 Folie geändert');
    expect(formatSyncSummary({ ...zero, commentsNew: 1, commentsRemoved: 1 })).toBe(
      '1 neuer Kommentar aus PowerPoint, 1 Kommentar in PowerPoint entfernt',
    );
    expect(formatSyncSummary({ ...zero, slidesMoved: 2, commentsRemoved: 2 })).toBe(
      '2 verschoben, 2 Kommentare in PowerPoint entfernt',
    );
  });

  it('says so when nothing visible changed', () => {
    expect(formatSyncSummary(zero)).toBe('Keine sichtbaren Änderungen');
  });
});

describe('sync contract', () => {
  const summary = { ...zero, slidesModified: 1, text: '1 Folie geändert' };
  const sync = {
    enabled: true,
    lastCheckedAt: '2026-10-08T10:00:00.000Z',
    lastSyncAt: null,
    lastSyncError: {
      code: 'auth_required',
      message: 'Die Verbindung zu Microsoft ist abgelaufen.',
      at: '2026-10-08T10:00:00.000Z',
      loginUrl: '/api/auth/microsoft/login?returnTo=%2Fd%2F1',
    },
    pending: false,
    pendingSince: null,
    latestSummary: summary,
  };

  it('parses API payloads', () => {
    expect(
      deckStatusSchema.parse({
        deckId: 'd1',
        revisionNumber: 2,
        currentRevisionId: 'r2',
        updatedAt: '2026-10-08T10:00:00.000Z',
        import: { status: 'ready' },
        sync,
      }).sync.lastSyncError?.code,
    ).toBe('auth_required');
    expect(syncResultSchema.parse({ status: 'updated', revisionId: 'r2', summary }).status).toBe(
      'updated',
    );
    expect(
      revisionDiffSchema.parse({
        revisionId: 'r2',
        number: 2,
        previousRevisionId: 'r1',
        slides: [
          {
            slideId: 's1',
            status: 'moved',
            moved: true,
            confidence: 0.92,
            position: 1,
            previousPosition: 0,
            matchedBy: 'sldId',
          },
        ],
        deletedSlides: [],
        summary,
      }).slides,
    ).toHaveLength(1);
  });

  it('keeps the new fields optional on existing schemas', () => {
    const deck = {
      id: 'd1',
      title: 'Q4',
      fileName: 'Q4.pptx',
      source: 'onedrive',
      owner: { id: 'u1', name: 'R', type: 'owner', color: 'red', avatarUrl: null },
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T10:00:00.000Z',
      archivedAt: null,
      revisionNumber: 1,
      slideCount: 1,
      openCommentCount: 0,
      thumbnailUrl: null,
      participants: [],
      import: { status: 'ready' },
    };
    expect(deckSchema.parse(deck).sync).toBeUndefined();
    expect(deckSchema.parse({ ...deck, currentRevisionId: 'r1', sync }).sync?.enabled).toBe(true);
    expect(
      slideSchema.parse({
        id: 's1',
        deckId: 'd1',
        position: 0,
        title: null,
        hidden: false,
        aspectRatio: 1.7,
        imageUrl: '/files/x.svg',
        thumbnailUrl: '/files/x.svg',
        shapes: [],
        openCommentCount: 0,
        change: { status: 'new', moved: false, confidence: 1 },
      }).change?.status,
    ).toBe('new');
    expect(commentSchema.shape.sourceStatus.parse(undefined)).toBeUndefined();
  });
});
