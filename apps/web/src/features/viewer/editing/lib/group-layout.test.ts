import { expect, it } from 'vitest';
import {
  alignMoves,
  distributeMoves,
  encloses,
  growBoxes,
  sameSizeBoxes,
  scaledFrames,
  shownRect,
  turnedFrames,
  SLIDE_RECT,
} from './group-layout';
import { flowed, flowMoves, inferredFlow } from './flow';

const ASPECT = 16 / 9;
const close = (value: number | undefined, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

it('lines up, spreads and encloses elements picked together as they show', () => {
  const a = { id: 'a', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } };
  const b = { id: 'b', bbox: { x: 0.4, y: 0.3, w: 0.1, h: 0.2 } };
  const c = { id: 'c', bbox: { x: 0.8, y: 0.2, w: 0.1, h: 0.1 } };
  const members = [a, b, c];

  // Left: every one to the leftmost edge; the one there does not move.
  const left = alignMoves(members, 'left', ASPECT);
  expect(left.has('a')).toBe(false);
  close(left.get('b')?.dx, -0.3);
  close(left.get('c')?.dx, -0.7);
  expect(left.get('b')?.dy).toBe(0);
  // Bottom: to the lowest edge (b's, 0.5).
  const bottom = alignMoves(members, 'bottom', ASPECT);
  close(bottom.get('a')?.dy, 0.3);
  close(bottom.get('c')?.dy, 0.2);
  // Centred across: on the middle of the box round all (0.1 … 0.9 → 0.5).
  close(alignMoves(members, 'center', ASPECT).get('a')?.dx, 0.3);
  // One alone lines up on the slide: centred, right, at its foot.
  close(alignMoves([a], 'center', ASPECT, SLIDE_RECT).get('a')?.dx, 0.3);
  close(alignMoves([a], 'right', ASPECT, SLIDE_RECT).get('a')?.dx, 0.7);
  close(alignMoves([a], 'bottom', ASPECT, SLIDE_RECT).get('a')?.dy, 0.8);

  // Spread across: the outer ones stay, the gaps are equal (0.8 − 0.3 − 0.1 = 0.4 → 0.2 each).
  const spread = distributeMoves(members, 'x', ASPECT);
  expect(spread.has('a')).toBe(false);
  expect(spread.has('c')).toBe(false);
  close(spread.get('b')?.dx, 0.5 - 0.4);
  // Two are nothing to spread.
  expect(distributeMoves([a, b], 'x', ASPECT).size).toBe(0);

  // Turned a quarter, a wide box shows tall: lined up by the box it shows, not its own.
  const turned = shownRect({ bbox: { x: 0.4, y: 0.4, w: 0.18, h: 0.16 }, rotation: 90 }, ASPECT);
  close(turned.w, (0.16 / ASPECT) * 1);
  close(turned.h, 0.18 * ASPECT);
  // A frame picks what lies wholly in it.
  const frame = { x: 0.05, y: 0.05, w: 0.5, h: 0.5 };
  expect(encloses(frame, a.bbox)).toBe(true);
  expect(encloses(frame, b.bbox)).toBe(true);
  expect(encloses(frame, c.bbox)).toBe(false);

  // Grown to the next lines: one alone its own box; several the box round them, each stretched
  // in its place (0.1 … 0.5 across → 0 … 1: 2.5 times as wide); turned ones are not.
  const lines = { x: [0, 0.5, 1], y: [0, 0.5, 1] };
  const alone = growBoxes([a], 'y', lines)!.get('a')!;
  close(alone.y, 0);
  close(alone.h, 0.5);
  close(alone.x, 0.1);
  const pair = growBoxes([a, b], 'x', lines)!;
  close(pair.get('a')!.x, 0);
  close(pair.get('a')!.w, 0.5);
  close(pair.get('b')!.x, 0.75);
  close(pair.get('b')!.w, 0.25);
  close(pair.get('b')!.y, 0.3);
  expect(growBoxes([a, { ...b, rotation: 30 }], 'x', lines)).toBeNull();
  expect(growBoxes([{ id: 'full', bbox: SLIDE_RECT }], 'x', lines)).toBeNull();
  // Same size: as wide as the widest (a, 0.2), each keeping its left edge and its height; a
  // already is, so it stays out; alike already: nothing.
  const wide = sameSizeBoxes(members, 'x')!;
  expect(wide.has('a')).toBe(false);
  close(wide.get('b')!.w, 0.2);
  close(wide.get('b')!.x, 0.4);
  close(wide.get('b')!.h, 0.2);
  close(sameSizeBoxes(members, 'y')!.get('a')!.h, 0.2);
  expect(sameSizeBoxes([b, c], 'x')).toBeNull();

  // A flow (Figma's auto layout) on a 16 × 9 cm slide: in a row in their order across, 1.6 cm
  // (0.1 of the width) apart from the first one's left, lined up at the top of the box round them.
  const page = { width: 16, height: 9 };
  const rects = members.map(({ id, bbox }) => ({ id, rect: bbox }));
  const row = flowMoves(rects, { direction: 'row', gap: 1.6, align: 'start' }, page);
  expect(row.has('a')).toBe(false);
  close(row.get('b')!.dx, 0.1 + 0.2 + 0.1 - 0.4);
  close(row.get('b')!.dy, -0.2);
  close(row.get('c')!.dx, 0.6 - 0.8);
  // A column lined up at the right, 0.9 cm (0.1 of the height) apart: a, then c, then b by middle.
  const column = flowMoves(rects, { direction: 'column', gap: 0.9, align: 'end' }, page);
  close(column.get('a')!.dx, 0.9 - 0.2 - 0.1);
  close(column.get('c')!.dy, 0.3 - 0.2);
  close(column.get('b')!.dy, 0.5 - 0.3);
  // As they stand: spread more across – a row, their mean gap in cm (0.1 and 0.3 of 16 cm → 3.2).
  expect(inferredFlow([a.bbox, b.bbox, c.bbox], page)).toEqual({
    direction: 'row',
    gap: 3.2,
    align: 'start',
  });
  expect(inferredFlow([a.bbox, b.bbox], page, 'column').direction).toBe('column');
  // An edit of one of a flow's elements takes the `setBox`es that lay it out again along; the
  // rest of the slide does not.
  const element = (id: string, bbox: (typeof a)['bbox']) =>
    ({ id, kind: 'shape', bbox, rotation: 0, movable: true, resizable: true }) as never;
  const flowGroup = {
    id: 'g',
    kind: 'group',
    bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 },
    rotation: 0,
    flow: { direction: 'row', gap: 1.6, align: 'start' },
    children: [element('a', a.bbox), element('b', b.bbox), element('c', c.bbox)],
  } as never;
  const context = {
    element: () => undefined,
    groupOf: (id: string) => (['a', 'b', 'c'].includes(id) ? flowGroup : undefined),
    heightOf: () => null,
    pageSize: page,
  };
  const grown = flowed(
    [{ type: 'setBox', elementId: 'a', box: { ...a.bbox, w: 0.3 } }],
    context,
    page.width / page.height,
  );
  expect(grown.map((operation) => 'elementId' in operation && operation.elementId)).toEqual([
    'a',
    'b',
    'c',
  ]);
  const pushed = grown[1]!;
  close(pushed.type === 'setBox' ? pushed.box.x : NaN, 0.1 + 0.3 + 0.1);
  expect(
    flowed([{ type: 'setLocked', elementId: 'x', locked: true }], context, 16 / 9),
  ).toHaveLength(1);
  // Spread over the length („Automatisch“): first and last stay at the ends of the box round them
  // (0.1 … 0.9), the gaps equal ((0.8 − 0.4) / 2 = 0.2: b at 0.5, c at 0.8 already).
  const spread2 = flowMoves(rects, { direction: 'row', gap: 'auto', align: 'start' }, page);
  close(spread2.get('b')!.dx, 0.5 - 0.4);
  expect(spread2.get('c')?.dx ?? 0).toBeCloseTo(0, 6);
  // In a frame of its own (Figma's fixed size): from its start, lined up in it.
  const framed = flowMoves(
    rects,
    { direction: 'row', gap: 0, align: 'end', frame: { x: 0, y: 0, w: 1, h: 1 } },
    page,
  );
  close(framed.get('a')!.dx, -0.1);
  close(framed.get('a')!.dy, 0.9 - 0.1);
  // Middles alike along the flow: their order across decides (a row made a column keeps it).
  const level = [
    { id: 'p', rect: { x: 0.5, y: 0.1, w: 0.1, h: 0.1 } },
    { id: 'q', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
  ];
  close(flowMoves(level, { direction: 'column', gap: 0, align: 'start' }, page).get('p')!.dy, 0.1);
  // The flow group's own box sized: the area it flows in, laid out there at once.
  const sized = flowed(
    [{ type: 'setBox', elementId: 'g', box: { x: 0, y: 0, w: 1, h: 0.5 } }],
    { ...context, element: (id: string) => (id === 'g' ? flowGroup : undefined) },
    16 / 9,
  );
  expect(sized[0]).toMatchObject({ type: 'setFlow', flow: { frame: { x: 0, w: 1 } } });
  expect(sized.length).toBeGreaterThan(1);
  // Only moved – its size off by the file's rounding at most –, it moves with its parts, no frame.
  const nudged = flowed(
    [{ type: 'setBox', elementId: 'g', box: { x: 0.2, y: 0.2, w: 0.80002, h: 0.39998 } }],
    { ...context, element: (id: string) => (id === 'g' ? flowGroup : undefined) },
    16 / 9,
  );
  expect(nudged).toHaveLength(1);
  expect(nudged[0]!.type).toBe('setBox');

  // Scaled with the box round them (0.1…0.5 × 0.1…0.5 → twice as wide): each keeps its place in
  // the box, its size goes with it – a group of the file only follows with its centre; turned a
  // quarter, its width goes with the box's height.
  const box = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };
  const flat = { ...a, sizes: true, turns: true };
  const fileGroup = { ...b, sizes: false, turns: false };
  const quarter = {
    id: 'q',
    bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.05 },
    rotation: 90,
    sizes: true,
    turns: true,
  };
  const scaled = scaledFrames([flat, fileGroup, quarter], box, { ...box, w: 0.8 });
  close(scaled.get('a')!.rect.x, 0.1);
  close(scaled.get('a')!.rect.w, 0.4);
  close(scaled.get('a')!.rect.h, 0.1);
  close(scaled.get('b')!.rect.w, 0.1);
  close(scaled.get('b')!.rect.x + 0.05, 0.1 + (0.45 - 0.1) * 2);
  close(scaled.get('q')!.rect.w, 0.1);
  close(scaled.get('q')!.rect.h, 0.1);
  // Turned a quarter round the box's centre (0.3, 0.3): each centre goes round it in true
  // proportions, its own turn grows by as much – a group of the file only goes round.
  const round = turnedFrames([flat, fileGroup], box, 90, ASPECT);
  const aCentre = { x: 0.2, y: 0.15 };
  close(round.get('a')!.rect.x + 0.1, 0.3 - (aCentre.y - 0.3) / ASPECT);
  close(round.get('a')!.rect.y + 0.05, 0.3 + (aCentre.x - 0.3) * ASPECT);
  expect(round.get('a')!.rotation).toBe(90);
  expect(round.get('b')!.rotation).toBe(0);
  expect(turnedFrames([{ ...flat, rotation: 300 }], box, 90, ASPECT).get('a')!.rotation).toBe(30);
});
