import type { Author, Comment, CreateCommentInput } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { confirmComment, isPendingComment, keepPending, pendingReply } from './comment-cache';

const author = (id: string, overrides: Partial<Author> = {}): Author => ({
  id,
  name: `Person ${id}`,
  type: 'owner',
  color: 'blue',
  ...overrides,
});

let sequence = 0;
const comment = (overrides: Partial<Comment> = {}): Comment => {
  sequence += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 1, 12, sequence)).toISOString();
  return {
    id: `c${sequence}`,
    deckId: 'd1',
    slideId: 's1',
    parentId: null,
    author: author('a1'),
    body: 'Text',
    anchor: { type: 'slide' },
    strokes: [],
    media: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    source: 'app',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
};

const replyInput = (root: Comment, body: string): CreateCommentInput => ({
  slideId: root.slideId,
  parentId: root.id,
  body,
  anchor: { type: 'slide' },
  strokes: [],
});

describe('pendingReply / confirmComment', () => {
  const root = comment();
  const viewer = author('me', { name: 'Ich' });
  const input = replyInput(root, 'Neu');

  it('builds an open app comment with a temporary id', () => {
    const now = new Date('2026-10-07T10:00:00.000Z');
    const pending = pendingReply(input, root, viewer, now);
    expect(isPendingComment(pending)).toBe(true);
    expect(pending).toMatchObject({
      parentId: root.id,
      author: viewer,
      body: 'Neu',
      status: 'open',
      source: 'app',
      createdAt: now.toISOString(),
    });
    expect(isPendingComment(root)).toBe(false);
  });

  it('creates unique placeholder ids without crypto.randomUUID (plain-http hosts)', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const first = pendingReply(input, root, viewer);
      const second = pendingReply(input, root, viewer);
      expect(isPendingComment(first)).toBe(true);
      expect(first.id).not.toBe(second.id);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });

  it('replaces the placeholder in place', () => {
    const pending = pendingReply(input, root, viewer);
    const saved = comment({ parentId: root.id, body: 'Neu' });
    expect(confirmComment([root, pending], pending.id, saved)).toEqual([root, saved]);
  });

  it('appends the saved comment if the placeholder is gone and never duplicates it', () => {
    const saved = comment({ parentId: root.id });
    expect(confirmComment([root], 'temp-x', saved)).toEqual([root, saved]);
    // A refetch already brought the saved comment and kept the placeholder.
    const pending = pendingReply(input, root, viewer);
    expect(confirmComment([root, saved, pending], pending.id, saved)).toEqual([root, saved]);
  });
});

describe('keepPending', () => {
  const viewer = author('me');
  const root = comment();
  const input = replyInput(root, 'Antwort');

  it('keeps placeholders the refetched list does not have yet', () => {
    const pending = pendingReply(input, root, viewer);
    const other = comment();
    expect(keepPending([root, pending], [root, other])).toEqual([root, other, pending]);
  });

  it('drops a placeholder once its reply is listed, without showing it twice', () => {
    const pending = pendingReply(input, root, viewer);
    const saved = comment({ parentId: root.id, author: viewer, body: 'Antwort' });
    expect(keepPending([root, pending], [root, saved])).toEqual([root, saved]);
  });

  it('returns the fresh list as is without placeholders', () => {
    const fresh = [root];
    expect(keepPending(undefined, fresh)).toBe(fresh);
    expect(keepPending([root], fresh)).toBe(fresh);
  });
});
