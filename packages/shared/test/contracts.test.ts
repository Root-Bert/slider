import { describe, expect, it } from 'vitest';
import {
  createWorkspaceInviteInputSchema,
  LIVE_EVENT,
  LIVE_HEARTBEAT_MS,
  livePresenceInputSchema,
  passkeyNameSchema,
  saveSetupInputSchema,
  SECRET_SETUP_KEYS,
  SETUP_KEYS,
  SETUP_TOKEN_HEADER,
  slideRenderingSchema,
  toSyncSummary,
  workspaceNameSchema,
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

describe('toSyncSummary', () => {
  it('keeps the counts and adds the German sentence', () => {
    expect(toSyncSummary({ ...zero, slidesMoved: 2, commentsRemoved: 1 })).toEqual({
      ...zero,
      slidesMoved: 2,
      commentsRemoved: 1,
      text: '2 verschoben, 1 Kommentar in PowerPoint entfernt',
    });
    expect(toSyncSummary(zero).text).toBe('Keine sichtbaren Änderungen');
  });

  it('uses the plural for updated comments', () => {
    expect(toSyncSummary({ ...zero, commentsUpdated: 2 }).text).toBe(
      '2 Kommentare in PowerPoint geändert',
    );
  });
});

describe('live presence (BER-104)', () => {
  it('accepts a cursor normalised to the slide and nulls', () => {
    expect(
      livePresenceInputSchema.safeParse({
        activeSlideId: 's1',
        cursor: { slideId: 's1', point: { x: 0.5, y: 1 } },
        focusedThreadId: null,
      }).success,
    ).toBe(true);
    expect(
      livePresenceInputSchema.safeParse({
        activeSlideId: null,
        cursor: null,
        focusedThreadId: null,
      }).success,
    ).toBe(true);
  });

  it('rejects cursors off the slide and empty or overlong ids', () => {
    const base = { activeSlideId: 's1', cursor: null, focusedThreadId: null };
    expect(
      livePresenceInputSchema.safeParse({
        ...base,
        cursor: { slideId: 's1', point: { x: 1.2, y: 0 } },
      }).success,
    ).toBe(false);
    expect(livePresenceInputSchema.safeParse({ ...base, activeSlideId: '' }).success).toBe(false);
    expect(
      livePresenceInputSchema.safeParse({ ...base, focusedThreadId: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('keeps the event name and heartbeat', () => {
    expect(LIVE_EVENT).toBe('live');
    expect(LIVE_HEARTBEAT_MS).toBe(15_000);
  });
});

describe('setup contract', () => {
  it('only lists secrets that are setup keys', () => {
    for (const key of SECRET_SETUP_KEYS) expect(SETUP_KEYS).toContain(key);
    expect(SETUP_TOKEN_HEADER).toBe('X-Setup-Token');
  });

  it('trims values, allows null to remove one and rejects unknown keys', () => {
    expect(
      saveSetupInputSchema.parse({ values: { MAIL_FROM: '  a@b.de ', SIGNUP: null } }),
    ).toEqual({
      values: { MAIL_FROM: 'a@b.de', SIGNUP: null },
    });
    expect(saveSetupInputSchema.safeParse({ values: { NOPE: 'x' } }).success).toBe(false);
    expect(
      saveSetupInputSchema.safeParse({ values: { MAIL_FROM: 'x'.repeat(2001) } }).success,
    ).toBe(false);
  });
});

describe('workspace inputs', () => {
  it('defaults an invite to member and validates the address', () => {
    expect(createWorkspaceInviteInputSchema.parse({})).toEqual({ role: 'member' });
    expect(createWorkspaceInviteInputSchema.parse({ email: 'a@b.de', role: 'viewer' })).toEqual({
      email: 'a@b.de',
      role: 'viewer',
    });
    expect(createWorkspaceInviteInputSchema.safeParse({ email: 'kein-mail' }).success).toBe(false);
    expect(createWorkspaceInviteInputSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('trims names and enforces their length', () => {
    expect(workspaceNameSchema.parse('  Acme ')).toBe('Acme');
    expect(workspaceNameSchema.safeParse('   ').success).toBe(false);
    expect(workspaceNameSchema.safeParse('x'.repeat(81)).success).toBe(false);
    expect(passkeyNameSchema.safeParse('x'.repeat(60)).success).toBe(true);
    expect(passkeyNameSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });
});

describe('slide rendering status', () => {
  it('accepts queued and running only', () => {
    expect(slideRenderingSchema.safeParse({ status: 'queued', done: 0, total: 0 }).success).toBe(
      true,
    );
    expect(slideRenderingSchema.safeParse({ status: 'ready', done: 1, total: 1 }).success).toBe(
      false,
    );
  });
});
