import { describe, expect, it } from 'vitest';
import {
  anchorRect,
  buildThreads,
  countByStatus,
  filterThreads,
  gapKey,
  gapThreadsByGap,
  groupThreadsBySlide,
  isStrokeOnly,
  sortThreadsByAnchor,
} from './comment-selectors';
import { author, comment, slide } from './test-fixtures';

describe('buildThreads', () => {
  it('groups replies under their root, oldest first, and collects participants', () => {
    const root = comment({ author: author('a') });
    const reply1 = comment({ parentId: root.id, author: author('b') });
    const reply2 = comment({ parentId: root.id, author: author('a') });
    const reply3 = comment({ parentId: root.id, author: author('c') });
    const other = comment();

    const threads = buildThreads([reply3, other, reply1, root, reply2]);

    expect(threads.map((t) => t.id)).toEqual([root.id, other.id]);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual([reply1.id, reply2.id, reply3.id]);
    expect(threads[0]!.repliers.map((a) => a.id)).toEqual(['b', 'c']);
    expect(threads[0]!.participants.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(threads[0]!.lastActivityAt).toBe(reply3.createdAt);
  });
});

describe('filters and counts', () => {
  const threads = buildThreads([
    comment({ status: 'open' }),
    comment({ status: 'done' }),
    comment({ status: 'open', source: 'pptx' }),
    comment({ status: 'done', source: 'pptx' }),
  ]);

  it('filters by status and PowerPoint origin', () => {
    expect(filterThreads(threads, { status: 'open', pptxOnly: false })).toHaveLength(2);
    expect(filterThreads(threads, { status: 'all', pptxOnly: false })).toHaveLength(4);
    expect(filterThreads(threads, { status: 'done', pptxOnly: true })).toHaveLength(1);
  });

  it('counts per status, respecting only the PowerPoint filter', () => {
    expect(countByStatus(threads, false)).toEqual({ all: 4, open: 2, done: 2 });
    expect(countByStatus(threads, true)).toEqual({ all: 2, open: 1, done: 1 });
  });
});

describe('grouping', () => {
  const slides = [slide('s1', 0), slide('s2', 1)];

  it('lists gap comments under the slide before the gap', () => {
    const onSlide = comment({ slideId: 's2' });
    const gap = comment({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' },
    });
    const groups = groupThreadsBySlide(buildThreads([onSlide, gap]), slides);
    expect(groups.get('s1')!.map((t) => t.id)).toEqual([gap.id]);
    expect(groups.get('s2')!.map((t) => t.id)).toEqual([onSlide.id]);
  });

  it('keys gap threads by their neighbours', () => {
    const gap = comment({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: null },
    });
    const groups = gapThreadsByGap(buildThreads([gap, comment()]));
    expect([...groups.keys()]).toEqual([gapKey('s1', null)]);
  });
});

describe('anchorRect', () => {
  it('resolves point anchors through their shape when it still exists', () => {
    const shapes = [
      { id: 'sh1', name: 'Title', text: '', bbox: { x: 0.2, y: 0.2, w: 0.4, h: 0.2 } },
    ];
    const rect = anchorRect(
      {
        anchor: {
          type: 'point',
          point: { x: 0, y: 0 },
          shapeRef: { shapeId: 'sh1', offset: { x: 0.5, y: 0.5 } },
        },
        strokes: [],
      },
      shapes,
    );
    expect(rect!.x).toBeCloseTo(0.4);
    expect(rect!.y).toBeCloseTo(0.3);
    expect(rect!.w).toBe(0);
  });

  it('uses stroke bounds for slide-level drawings and nothing for gaps', () => {
    const strokes = [
      {
        tool: 'pen' as const,
        color: 'red' as const,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.6 },
        ],
      },
    ];
    const bounds = anchorRect({ anchor: { type: 'slide' }, strokes }, [])!;
    expect([bounds.x, bounds.y, bounds.w, bounds.h].map((v) => v.toFixed(2))).toEqual([
      '0.10',
      '0.20',
      '0.20',
      '0.40',
    ]);
    expect(
      anchorRect(
        { anchor: { type: 'gap', afterSlideId: null, beforeSlideId: null }, strokes: [] },
        [],
      ),
    ).toBeNull();
  });
});

it('sorts threads left to right by anchor, anchorless last', () => {
  const right = comment({ anchor: { type: 'point', point: { x: 0.9, y: 0.1 }, shapeRef: null } });
  const left = comment({
    anchor: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, shapeRef: null },
  });
  const slideLevel = comment({ anchor: { type: 'slide' } });
  const sorted = sortThreadsByAnchor(buildThreads([slideLevel, right, left]), []);
  expect(sorted.map((t) => t.id)).toEqual([left.id, right.id, slideLevel.id]);
});

it('detects drawing-only comments', () => {
  const strokes = [
    {
      tool: 'pen' as const,
      color: 'red' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ];
  expect(isStrokeOnly(comment({ body: '  ', strokes }))).toBe(true);
  expect(isStrokeOnly(comment({ body: 'Hi', strokes }))).toBe(false);
});
