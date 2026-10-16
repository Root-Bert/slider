import type { Anchor } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { collapseReplies, replyInput } from './replies';
import { comment } from '../../lib/test-fixtures';

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
