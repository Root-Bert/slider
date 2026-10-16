import type { Anchor } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { confirmComment, isPendingComment, pendingReply } from '@/lib/comment-cache';
import { collapseReplies, replyInput } from './replies';
import { author, comment } from './test-fixtures';

describe('replyInput', () => {
  const anchors: Anchor[] = [
    { type: 'point', point: { x: 0.1, y: 0.2 }, shapeRef: null },
    { type: 'rect', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, shapeRef: null },
    { type: 'slide' },
  ];

  it.each(anchors)('always sends a slide anchor (root anchored as $type)', (anchor) => {
    const root = comment({ anchor });
    expect(replyInput(root, '  Passt so  ')).toEqual({
      slideId: root.slideId,
      parentId: root.id,
      body: 'Passt so',
      anchor: { type: 'slide' },
      strokes: [],
    });
  });

  it('works for gap roots (no slide) and PowerPoint roots', () => {
    const gapRoot = comment({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' },
    });
    expect(replyInput(gapRoot, 'x')).toMatchObject({ slideId: null, anchor: { type: 'slide' } });

    const pptxRoot = comment({ source: 'pptx' });
    expect(replyInput(pptxRoot, 'x')).toMatchObject({
      parentId: pptxRoot.id,
      anchor: { type: 'slide' },
    });
  });
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

describe('collapseReplies', () => {
  const replies = [1, 2, 3, 4, 5];

  it('keeps the newest three and counts the rest', () => {
    expect(collapseReplies(replies, false)).toEqual({ hidden: 2, visible: [3, 4, 5] });
  });

  it('shows everything when expanded or short', () => {
    expect(collapseReplies(replies, true)).toEqual({ hidden: 0, visible: replies });
    expect(collapseReplies([1, 2, 3], false)).toEqual({ hidden: 0, visible: [1, 2, 3] });
    expect(collapseReplies([], false)).toEqual({ hidden: 0, visible: [] });
  });
});
