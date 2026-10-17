import { describe, expect, it } from 'vitest';
import {
  anchorRect,
  buildThreads,
  connectorAnchor,
  countByStatus,
  filterThreads,
  gapKey,
  gapThreadsByGap,
  groupThreadsBySlide,
  isImplicitFrame,
  isStrokeOnly,
  openCountBySlide,
  placeGap,
  sortThreadsByAnchor,
  sortThreadsClockwise,
  connectorExits,
  threadsByDeletedSlide,
  threadsOnCurrentSlides,
} from './comment-selectors';
import { author, comment, slide } from '../../lib/test-fixtures';

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

  it('filters by status; PowerPoint comments count like any other', () => {
    expect(filterThreads(threads, { status: 'open' })).toHaveLength(2);
    expect(filterThreads(threads, { status: 'all' })).toHaveLength(4);
    expect(filterThreads(threads, { status: 'done' })).toHaveLength(2);
  });

  it('keeps threads being replied to, whatever their status – not past the avatar filter', () => {
    const done = threads[1]!;
    const keep = new Set([done.id]);
    expect(filterThreads(threads, { status: 'open', keep })).toContain(done);
    expect(filterThreads(threads, { status: 'open', keep })).toHaveLength(3);
    expect(filterThreads(threads, { status: 'open', keep, threadIds: new Set() })).toEqual([]);
  });

  it('counts per status', () => {
    expect(countByStatus(threads)).toEqual({ all: 4, open: 2, done: 2 });
  });

  it('counts open threads per slide like the slide list does', () => {
    const counts = openCountBySlide(
      buildThreads([
        comment({ slideId: 's1' }),
        comment({ slideId: 's1' }),
        comment({ slideId: 's1', status: 'done' }),
        comment({ slideId: 's1', sourceStatus: 'removed_in_pptx' }),
        comment({ slideId: 's2' }),
        comment({ slideId: 's2', parentId: 'elsewhere' }),
        comment({
          slideId: null,
          anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' },
        }),
      ]),
    );
    expect([...counts]).toEqual([
      ['s1', 2],
      ['s2', 1],
    ]);
  });
});

describe('threadsOnCurrentSlides', () => {
  it('leaves out threads on deleted slides', () => {
    const threads = buildThreads([
      comment({ slideId: 's1' }),
      comment({ slideId: 'deleted' }),
      comment({ slideId: null }),
    ]);
    const kept = threadsOnCurrentSlides(threads, [slide('s1', 0), slide('s2', 1)]);
    expect(kept.map((thread) => thread.root.slideId)).toEqual(['s1', null]);
    expect(countByStatus(kept).all).toBe(2);
  });

  it('counts a gap comment while one neighbour is left, not once both are gone', () => {
    const between = (afterSlideId: string | null, beforeSlideId: string | null) =>
      comment({ slideId: null, anchor: { type: 'gap', afterSlideId, beforeSlideId } });
    const kept = between('gone', 's2');
    const lost = between('gone', 'gone too');
    const threads = buildThreads([kept, lost]);
    expect(
      threadsOnCurrentSlides(threads, [slide('s1', 0), slide('s2', 1)]).map((t) => t.id),
    ).toEqual([kept.id]);
  });
});

describe('placeGap', () => {
  const order = [slide('s1', 0), slide('new', 1), slide('s2', 2), slide('s3', 3)];
  const at = (afterSlideId: string | null, beforeSlideId: string | null) =>
    placeGap({ afterSlideId, beforeSlideId }, order);

  it('keeps a gap whose neighbours are still neighbours', () => {
    expect(at('s2', 's3')).toEqual({ afterSlideId: 's2', beforeSlideId: 's3' });
    expect(at(null, 's1')).toEqual({ afterSlideId: null, beforeSlideId: 's1' });
    expect(at('s3', null)).toEqual({ afterSlideId: 's3', beforeSlideId: null });
  });

  it('follows the slide before the gap when a slide was inserted or moved there', () => {
    expect(at('s1', 's2')).toEqual({ afterSlideId: 's1', beforeSlideId: 'new' });
    expect(at('s3', 's1')).toEqual({ afterSlideId: 's3', beforeSlideId: null });
  });

  it('falls back to the slide after the gap, or the deck’s end, when the one before is gone', () => {
    expect(at('gone', 's2')).toEqual({ afterSlideId: 'new', beforeSlideId: 's2' });
    expect(at('gone', 's1')).toEqual({ afterSlideId: null, beforeSlideId: 's1' });
    expect(at('gone', null)).toEqual({ afterSlideId: 's3', beforeSlideId: null });
  });

  it('has no place once both neighbours are gone, or without slides', () => {
    expect(at('gone', 'gone too')).toBeNull();
    expect(placeGap({ afterSlideId: null, beforeSlideId: null }, [])).toBeNull();
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
      anchor: { type: 'gap', afterSlideId: 's2', beforeSlideId: null },
    });
    const groups = gapThreadsByGap(buildThreads([gap, comment()]), slides);
    expect([...groups.keys()]).toEqual([gapKey('s2', null)]);
  });

  it('keys and lists a gap thread where it sits now when its neighbours were separated', () => {
    // Written between s1 and s2; a later version inserted a slide there and deleted s2.
    const gap = comment({
      slideId: null,
      anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' },
    });
    const now = [slide('s1', 0), slide('new', 1), slide('s3', 2)];
    const threads = buildThreads([gap]);
    expect([...gapThreadsByGap(threads, now).keys()]).toEqual([gapKey('s1', 'new')]);
    // Its slide before is gone: in front of the slide after it, listed under the one before that.
    const moved = buildThreads([
      comment({
        slideId: null,
        anchor: { type: 'gap', afterSlideId: 'gone', beforeSlideId: 's3' },
      }),
    ]);
    expect([...gapThreadsByGap(moved, now).keys()]).toEqual([gapKey('new', 's3')]);
    expect(groupThreadsBySlide(moved, now).get('new')).toHaveLength(1);
  });

  it('lists a gap thread under its deleted slide only once both neighbours are gone', () => {
    const gap = (afterSlideId: string | null, beforeSlideId: string | null) =>
      comment({ slideId: null, anchor: { type: 'gap', afterSlideId, beforeSlideId } });
    const stillPlaced = gap('d1', 's1');
    const bothGone = gap('d1', 'd2');
    const afterGone = gap('hidden', 'd2');
    const onDeleted = comment({ slideId: 'd2' });
    const groups = threadsByDeletedSlide(
      buildThreads([stillPlaced, bothGone, afterGone, onDeleted]),
      ['d1', 'd2'],
      slides,
    );
    expect(groups.get('d1')!.map((t) => t.id)).toEqual([bothGone.id]);
    expect(groups.get('d2')!.map((t) => t.id)).toEqual([afterGone.id, onDeleted.id]);
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

describe('connectorAnchor', () => {
  it('starts at the edge of a pin, wider for PowerPoint pins', () => {
    const pin = comment({ anchor: { type: 'point', point: { x: 0.9, y: 0.1 }, shapeRef: null } });
    expect(connectorAnchor(pin, [])).toEqual({
      left: 0.9,
      right: 0.9,
      start: { left: { x: 0.9, y: 0.1 }, right: { x: 0.9, y: 0.1 } },
      bottom: { x: 0.9, y: 0.1 },
      inset: { left: 7, right: 7, bottom: 7 },
    });
    expect(connectorAnchor({ ...pin, source: 'pptx' }, [])!.inset).toEqual({
      left: 7,
      right: 7,
      bottom: 7,
    });
  });

  it('starts in the middle of a frame edge', () => {
    const frame = comment({
      anchor: { type: 'rect', rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, shapeRef: null },
    });
    expect(connectorAnchor(frame, [])!.start).toEqual({
      left: { x: 0.25, y: 0.5 },
      right: { x: 0.75, y: 0.5 },
    });
  });

  it('starts at the outermost point of a drawing, outside its stroke', () => {
    const drawing = comment({
      anchor: { type: 'slide' },
      strokes: [
        {
          tool: 'arrow',
          color: 'blue',
          points: [
            { x: 0.1, y: 0.5 },
            { x: 0.3, y: 0.2 },
          ],
        },
      ],
    });
    expect(connectorAnchor(drawing, [])).toEqual({
      left: 0.1,
      right: 0.3,
      start: { left: { x: 0.1, y: 0.5 }, right: { x: 0.3, y: 0.2 } },
      bottom: { x: 0.1, y: 0.5 },
      inset: { left: 1.5, right: 1.5, bottom: 1.5 },
    });
  });

  it('has no line for slide-level and gap comments', () => {
    expect(connectorAnchor(comment({ anchor: { type: 'slide' } }), [])).toBeNull();
    const gap = comment({ anchor: { type: 'gap', afterSlideId: 's1', beforeSlideId: 's2' } });
    expect(connectorAnchor(gap, [])).toBeNull();
  });
});

it('orders threads clockwise around the slide, lineless last', () => {
  const point = (x: number, y: number) =>
    comment({ anchor: { type: 'point', point: { x, y }, shapeRef: null } });
  const leftLow = point(0.1, 0.8);
  const leftHigh = point(0.2, 0.1);
  const rightLow = point(0.9, 0.9);
  const rightHigh = point(0.8, 0.2);
  const slideLevel = comment({ anchor: { type: 'slide' } });
  const sorted = sortThreadsClockwise(
    buildThreads([slideLevel, rightHigh, leftLow, rightLow, leftHigh]),
    [],
  );
  expect(sorted.map((t) => t.id)).toEqual([
    leftHigh.id,
    leftLow.id,
    rightLow.id,
    rightHigh.id,
    slideLevel.id,
  ]);
});

describe('connectorExits', () => {
  const frame = (x: number, y: number, w: number, h: number) =>
    connectorAnchor(
      comment({ anchor: { type: 'rect', rect: { x, y, w, h }, shapeRef: null } }),
      [],
    );

  it('drops straight down when the bottom edge is nearer than a side edge', () => {
    // 16:9 – the middle of the lower half: 0.4 heights down, 0.7 heights to the side.
    expect(connectorExits([frame(0.4, 0.4, 0.2, 0.2)], 16 / 9)).toEqual(['down']);
    // Close to the left edge: sideways.
    expect(connectorExits([frame(0.02, 0.4, 0.2, 0.2)], 16 / 9)).toEqual(['left']);
  });

  it('always leaves sideways without an aspect ratio', () => {
    expect(connectorExits([frame(0.3, 0.4, 0.2, 0.2), null])).toEqual(['left', null]);
  });

  it('orders downward lines between the left and the right ones', () => {
    const at = (x: number, y: number) =>
      comment({ anchor: { type: 'rect', rect: { x, y, w: 0.05, h: 0.05 }, shapeRef: null } });
    const left = at(0.02, 0.5);
    const downB = at(0.6, 0.85);
    const downA = at(0.4, 0.85);
    const right = at(0.93, 0.5);
    const sorted = sortThreadsClockwise(buildThreads([right, downB, left, downA]), [], 16 / 9);
    expect(sorted.map((t) => t.id)).toEqual([left.id, downA.id, downB.id, right.id]);
  });
});

describe('isImplicitFrame', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
  const text = {
    tool: 'text' as const,
    color: 'red' as const,
    ...rect,
    text: 'Hallo',
    fontSize: 0.04,
  };
  const ellipse = {
    tool: 'ellipse' as const,
    color: 'red' as const,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.4, y: 0.3 },
    ],
  };
  const pen = { ...ellipse, tool: 'pen' as const };

  it('hides the frame of text boxes and drawings – they are the mark', () => {
    expect(
      isImplicitFrame({ anchor: { type: 'rect', rect, shapeRef: null }, strokes: [text] }),
    ).toBe(true);
    expect(
      isImplicitFrame({ anchor: { type: 'rect', rect, shapeRef: null }, strokes: [ellipse] }),
    ).toBe(true);
    expect(
      isImplicitFrame({ anchor: { type: 'rect', rect, shapeRef: null }, strokes: [pen] }),
    ).toBe(true);
  });

  it('keeps explicit frames', () => {
    const wider = { ...rect, w: 0.5 };
    expect(
      isImplicitFrame({
        anchor: { type: 'rect', rect: wider, shapeRef: null },
        strokes: [ellipse],
      }),
    ).toBe(false);
    expect(
      isImplicitFrame({ anchor: { type: 'rect', rect: wider, shapeRef: null }, strokes: [pen] }),
    ).toBe(false);
    expect(isImplicitFrame({ anchor: { type: 'rect', rect, shapeRef: null }, strokes: [] })).toBe(
      false,
    );
  });

  it('starts the connector line at the text box', () => {
    const anchor = connectorAnchor(
      comment({ anchor: { type: 'rect', rect, shapeRef: null }, strokes: [text] }),
      [],
    );
    expect(anchor?.start.left).toEqual({ x: 0.1, y: 0.25 });
  });
});
