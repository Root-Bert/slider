import { describe, expect, it } from 'vitest';
import {
  axisLocked,
  boxLines,
  caughtBoxes,
  caughtGaps,
  caughtLines,
  drawnRect,
  fittedToText,
  grownToLines,
  MIN_RECT_SIZE,
  moved,
  resized,
  resizedThrough,
  resizedTurned,
  snappedPoint,
  snappedToLines,
  snappedToText,
  snappedTurn,
  turnedCorner,
  withSlideLines,
} from './rect-edit';

const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

describe('moved', () => {
  it('shifts the box and keeps it on the slide unless unbounded', () => {
    const shifted = moved(start, 0.1, -0.1);
    expect(shifted.x).toBeCloseTo(0.3);
    expect(shifted.y).toBeCloseTo(0.1);
    expect(shifted).toMatchObject({ w: 0.4, h: 0.4 });
    const pushed = moved(start, 1, 1);
    expect(pushed.x).toBeCloseTo(0.6);
    expect(pushed.y).toBeCloseTo(0.6);
    expect(moved(start, -1, -1)).toMatchObject({ x: 0, y: 0 });

    // Not bounded: beyond the edge, moved and resized.
    const loose = moved(start, 0.7, -0.5, false);
    expect(loose.x).toBeCloseTo(0.9);
    expect(loose.y).toBeCloseTo(-0.3);
    expect(loose).toMatchObject({ w: 0.4, h: 0.4 });
    const grown = resized(start, 'se', 1.3, 1.1, MIN_RECT_SIZE, false);
    expect(grown.w).toBeCloseTo(1.1);
    expect(grown.h).toBeCloseTo(0.9);
    const locked = axisLocked(start, 'se', 1.3, 1.31, 0, 1, false);
    expect(locked.x).toBeCloseTo(locked.y);
    expect(locked.x).toBeGreaterThan(1);
  });
});

describe('resized', () => {
  it('drags a corner, the opposite one fixed, within the minimum size and the slide', () => {
    const corners = [
      ['se', 0.8, 0.9, { x: 0.2, y: 0.2, w: 0.6, h: 0.7 }],
      ['nw', 0.1, 0.1, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }],
      ['ne', 0.7, 0.1, { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }],
      ['sw', 0.1, 0.7, { x: 0.1, y: 0.2, w: 0.5, h: 0.5 }],
    ] as const;
    for (const [corner, px, py, expected] of corners) {
      const rect = resized(start, corner, px, py);
      expect(rect.x).toBeCloseTo(expected.x);
      expect(rect.y).toBeCloseTo(expected.y);
      expect(rect.w).toBeCloseTo(expected.w);
      expect(rect.h).toBeCloseTo(expected.h);
    }

    // Past the opposite corner: the minimum size.
    const rect = resized(start, 'se', 0, 0);
    expect(rect.w).toBeCloseTo(MIN_RECT_SIZE.w);
    expect(rect.h).toBeCloseTo(MIN_RECT_SIZE.h);
    expect(resized(start, 'nw', 1, 1, { w: 0.1, h: 0.1 }).w).toBeCloseTo(0.1);
    // The pointer is clamped to the slide.
    expect(resized(start, 'se', 2, 2)).toMatchObject({ w: 0.8, h: 0.8 });
    expect(resized(start, 'nw', -1, -1)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('resizedTurned', () => {
  const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 };
  const aspect = 16 / 9;

  it('keeps the opposite corner where it is on the slide, and the turn', () => {
    // Without a turn: a plain resize.
    const plain = resized(box, 'se', 0.5, 0.4);
    const turned = resizedTurned(box, 'se', 0.5, 0.4, 0, aspect);
    for (const key of ['x', 'y', 'w', 'h'] as const) expect(turned[key]).toBeCloseTo(plain[key], 9);
    for (const rotation of [30, 90, 200]) {
      const fixed = turnedCorner(box, 'nw', rotation, aspect);
      // The corner dragged to 0.3 × 0.15 from the fixed one, along the box's own directions.
      const angle = (rotation * Math.PI) / 180;
      const [dx, dy] = [0.3 * aspect, 0.15];
      const target = {
        x: fixed.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / aspect,
        y: fixed.y + dx * Math.sin(angle) + dy * Math.cos(angle),
      };
      const next = resizedTurned(box, 'se', target.x, target.y, rotation, aspect);
      expect(next.w).toBeCloseTo(0.3, 9);
      expect(next.h).toBeCloseTo(0.15, 9);
      const still = turnedCorner(next, 'nw', rotation, aspect);
      expect(still.x).toBeCloseTo(fixed.x, 9);
      expect(still.y).toBeCloseTo(fixed.y, 9);
    }
  });
});

describe('axisLocked', () => {
  it('keeps only the axis dragged further along, or the proportions near the diagonal', () => {
    const across = axisLocked(start, 'se', 0.8, 0.65, 0, 1);
    expect(across.x).toBeCloseTo(0.8);
    expect(across.y).toBeCloseTo(0.6);
    const tall = axisLocked(start, 'nw', 0.25, 0.05, 0, 1);
    expect(tall.x).toBeCloseTo(0.2);
    expect(tall.y).toBeCloseTo(0.05);

    const wide = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
    // Out along the diagonal, a little off it: grown to twice, still 2 : 1.
    const out = axisLocked(wide, 'se', 1.0, 0.63, 0, 1);
    const grown = resized(wide, 'se', out.x, out.y);
    expect(grown.w / grown.h).toBeCloseTo(2);
    expect(grown.w).toBeGreaterThan(0.75);
    // Back in, from the other corner.
    const back = axisLocked(wide, 'nw', 0.4, 0.31, 0, 1);
    const shrunk = resized(wide, 'nw', back.x, back.y);
    expect(shrunk.w / shrunk.h).toBeCloseTo(2);
    expect(shrunk.w).toBeLessThan(0.4);
    // The edge of the slide stops it without bending the proportions.
    const far = axisLocked(wide, 'se', 1.6, 0.9, 0, 1);
    expect(far.x).toBeCloseTo(1);
    expect(far.y).toBeCloseTo(0.6);
    // Well off the diagonal, still away from the axes: the proportions hold.
    const off = axisLocked(wide, 'se', 0.7, 0.52, 0, 1);
    const kept = resized(wide, 'se', off.x, off.y);
    expect(kept.w / kept.h).toBeCloseTo(2);
    // Across the diagonal, and close to an axis: one side only, as before.
    expect(axisLocked(wide, 'se', 0.9, 0.42, 0, 1).y).toBeCloseTo(0.4);
    expect(axisLocked(wide, 'se', 0.55, 0.5, 0, 1).x).toBeCloseTo(0.6);
  });

  it('follows the axes and the diagonal of a turned box', () => {
    const corner = turnedCorner(start, 'se', 90, 1);
    // Turned a quarter, the se corner's diagonal points down and left.
    const to = axisLocked(start, 'se', corner.x - 0.2, corner.y + 0.21, 90, 1);
    const grown = resizedTurned(start, 'se', to.x, to.y, 90, 1);
    expect(grown.w).toBeCloseTo(grown.h);
    expect(grown.w).toBeGreaterThan(0.55);
    // Dragging down the slide is along its width.
    const along = axisLocked(start, 'se', corner.x + 0.02, corner.y + 0.2, 90, 1);
    expect(along.x).toBeCloseTo(corner.x);
    expect(along.y).toBeCloseTo(corner.y + 0.2);
    const wider = resizedTurned(start, 'se', along.x, along.y, 90, 1);
    expect(wider.w).toBeCloseTo(0.6);
    expect(wider.h).toBeCloseTo(0.4);
  });
});

describe('snappedToText', () => {
  // A text 0.3 wide on one line, 0.1 high there; twice as high at half the width.
  const text = { width: 0.3, heightAt: (w: number) => (w >= 0.3 ? 0.1 : 0.03 / w) };
  const near = { w: 0.01, h: 0.01 };
  const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };

  it('catches the width at its longest line and the height at its text, close by only', () => {
    const caught = snappedToText({ ...box, w: 0.305 }, box, 'se', text, near);
    expect(caught).toMatchObject({ x: 0.2, w: 0.3, h: 0.3 });
    expect(snappedToText({ ...box, w: 0.33 }, box, 'se', text, near).w).toBeCloseTo(0.33);
    // From the left: the right edge stays.
    const left = snappedToText({ ...box, x: 0.295, w: 0.305 }, box, 'nw', text, near);
    expect(left.x).toBeCloseTo(0.3);
    expect(left.w).toBeCloseTo(0.3);

    // The height at the width it has.
    const high = snappedToText({ ...box, w: 0.2, h: 0.155 }, box, 'se', text, near);
    expect(high.h).toBeCloseTo(0.15);
    // From the top: the bottom stays.
    const top = snappedToText({ ...box, y: 0.39, h: 0.11 }, box, 'ne', text, near);
    expect(top.y).toBeCloseTo(0.4);
    expect(top.h).toBeCloseTo(0.1);

    // Only the height dragged: the width stays though it is close.
    const tall = { ...box, w: 0.305 };
    expect(snappedToText({ ...tall, h: 0.2 }, tall, 'se', text, near).w).toBeCloseTo(0.305);
    // In proportion: the height follows the caught width.
    const scaled = snappedToText({ ...box, w: 0.305, h: 0.22875 }, box, 'se', text, near);
    expect(scaled.w).toBeCloseTo(0.3);
    expect(scaled.h).toBeCloseTo(0.225);

    // A double click on a corner fits it to its text, the opposite corner staying.
    const fitted = fittedToText(box, 'se', text);
    expect([fitted.x, fitted.y, fitted.w, fitted.h].map((v) => v.toFixed(6))).toEqual(
      [0.2, 0.2, 0.3, 0.1].map((v) => v.toFixed(6)),
    );
    const fromTop = fittedToText(box, 'nw', text);
    expect(fromTop.x).toBeCloseTo(0.3);
    expect(fromTop.y).toBeCloseTo(0.4);
    // Turned half a turn: the opposite corner stays where it is on the slide.
    const flipped = fittedToText(box, 'se', text, 180, 1);
    expect(flipped.x + flipped.w).toBeCloseTo(0.6);
    expect(flipped.y + flipped.h).toBeCloseTo(0.5);
  });
});

describe('snappedTurn', () => {
  it('snaps near 45°, steps by 15° with ⌥, stays within a turn', () => {
    expect(snappedTurn(47)).toBe(45);
    expect(snappedTurn(52.34)).toBe(52.3);
    expect(snappedTurn(52, true)).toBe(45);
    expect(snappedTurn(-90)).toBe(270);
    expect(snappedTurn(359)).toBe(0);
  });
});

describe('resizedThrough', () => {
  const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };

  it('resizes plainly short of the opposite side and mirrors the box pulled over it', () => {
    const plain = resizedThrough(box, 'se', 0.5, 0.45, 0, 1);
    expect(plain.mirrored).toEqual({ x: false, y: false });
    expect(plain.rect.x).toBeCloseTo(0.2);
    expect(plain.rect.w).toBeCloseTo(0.3);
    expect(plain.rect.h).toBeCloseTo(0.25);

    const over = resizedThrough(box, 'se', 0.1, 0.3, 0, 1);
    expect(over.mirrored).toEqual({ x: true, y: false });
    expect(over.rect.x).toBeCloseTo(0.1);
    expect(over.rect.y).toBeCloseTo(0.2);
    expect(over.rect.w).toBeCloseTo(0.1);
    expect(over.rect.h).toBeCloseTo(0.1);

    // Both ways through the opposite corner.
    const both = resizedThrough(box, 'nw', 0.5, 0.5, 0, 1);
    expect(both.mirrored).toEqual({ x: true, y: true });
    expect(both.rect.x).toBeCloseTo(0.4);
    expect(both.rect.y).toBeCloseTo(0.4);
    expect(both.rect.w).toBeCloseTo(0.1);
  });
});

describe('snappedToLines', () => {
  const lines = { x: [0.25, 0.75], y: [0.5] };
  const tolerance = { w: 0.02, h: 0.02 };

  it('snaps a moved box or the pulled sides of a resized one onto the nearest line', () => {
    const { rect, caught } = snappedToLines(
      { x: 0.26, y: 0.1, w: 0.2, h: 0.2 },
      start,
      'move',
      lines,
      tolerance,
    );
    expect(rect.x).toBeCloseTo(0.25);
    expect(rect.y).toBeCloseTo(0.1);
    expect(caught).toBe('0.25,-');
    // Its middle (0.39 + 0.1) caught at 0.5.
    const middle = snappedToLines(
      { x: 0.1, y: 0.39, w: 0.2, h: 0.2 },
      start,
      'move',
      lines,
      tolerance,
    );
    expect(middle.rect.y).toBeCloseTo(0.4);
    // Another element's sides and middles catch it too (Figma's smart guides): its right side onto
    // the other's left, the lines it lies on drawn; a turned one by what it covers, one off the
    // slide not at all.
    const other = boxLines(
      [
        { bbox: { x: 0.6, y: 0.3, w: 0.2, h: 0.1 } },
        { bbox: { x: 0.1, y: 0.7, w: 0.2, h: 0.1 }, rotation: 90 },
        { bbox: { x: 1.2, y: 0.1, w: 0.1, h: 0.1 } },
      ],
      1,
    );
    expect(other.x.slice(0, 3)).toEqual([0.6, 0.7, 0.8]);
    expect(other.x).toHaveLength(6);
    expect(other.x[3]).toBeCloseTo(0.15);
    expect(other.y[5]).toBeCloseTo(0.85);
    expect(other.y[0]).toBeCloseTo(0.3);
    const docked = snappedToLines(
      { x: 0.41, y: 0.29, w: 0.18, h: 0.1 },
      start,
      'move',
      other,
      tolerance,
    );
    expect(docked.rect.x + docked.rect.w).toBeCloseTo(0.6);
    expect(docked.rect.y).toBeCloseTo(0.3);
    expect(caughtLines(docked.rect, other)).toEqual({ x: [0.6], y: [0.3, 0.35, 0.4] });
    // The element it docked at framed, the turned one (not on a caught line) not.
    expect(caughtBoxes(docked.rect, other)).toEqual([other.boxes![0]]);
    // Equal gaps (Figma's spacing): two boxes 0.1 apart in a row – a third carries the gap on, and
    // between two it is centred; the gaps of that size are drawn, the boxes framed.
    const row = boxLines(
      [{ bbox: { x: 0.1, y: 0.6, w: 0.1, h: 0.1 } }, { bbox: { x: 0.3, y: 0.6, w: 0.1, h: 0.1 } }],
      1,
    );
    const free = { x: [], y: [], boxes: row.boxes };
    const next = snappedToLines(
      { x: 0.51, y: 0.62, w: 0.1, h: 0.1 },
      start,
      'move',
      free,
      tolerance,
    );
    expect(next.rect.x).toBeCloseTo(0.5);
    expect(caughtGaps(next.rect, free).map((gap) => [gap.axis, gap.start, gap.end])).toEqual([
      ['x', 0.2, 0.3],
      ['x', 0.4, expect.closeTo(0.5)],
    ]);
    expect(caughtBoxes(next.rect, free)).toHaveLength(2);
    // Its gaps worked out already: the same boxes.
    expect(caughtBoxes(next.rect, free, caughtGaps(next.rect, free))).toEqual(
      caughtBoxes(next.rect, free),
    );
    const wide = boxLines(
      [{ bbox: { x: 0.1, y: 0.6, w: 0.1, h: 0.1 } }, { bbox: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } }],
      1,
    );
    const between = snappedToLines(
      { x: 0.36, y: 0.6, w: 0.1, h: 0.1 },
      start,
      'move',
      { x: [], y: [], boxes: wide.boxes },
      tolerance,
    );
    expect(between.rect.x).toBeCloseTo(0.35);
    // Not beside them (another row): no gaps.
    expect(caughtGaps({ x: 0.5, y: 0.1, w: 0.1, h: 0.1 }, free)).toEqual([]);
    // Far from every line: as it is.
    const box = { x: 0.4, y: 0.1, w: 0.2, h: 0.2 };
    expect(snappedToLines(box, start, 'move', lines, tolerance)).toEqual({
      rect: box,
      caught: null,
    });

    // Resized: only the pulled sides, the opposite corner fixed.
    const pulled = snappedToLines(
      { x: 0.2, y: 0.2, w: 0.54, h: 0.31 },
      start,
      'se',
      lines,
      tolerance,
    );
    expect(pulled.rect.x).toBeCloseTo(0.2);
    expect(pulled.rect.w).toBeCloseTo(0.55);
    expect(pulled.rect.h).toBeCloseTo(0.3);
    const west = snappedToLines(
      { x: 0.26, y: 0.2, w: 0.34, h: 0.4 },
      start,
      'nw',
      lines,
      tolerance,
    );
    expect(west.rect.x).toBeCloseTo(0.25);
    expect(west.rect.x + west.rect.w).toBeCloseTo(0.6);
    // In proportion so.
    const square = snappedToLines(
      { x: 0.2, y: 0.2, w: 0.54, h: 0.54 },
      start,
      'se',
      lines,
      tolerance,
    );
    expect(square.rect.w).toBeCloseTo(0.55);
    expect(square.rect.h).toBeCloseTo(0.55);

    // The slide's own edges and middles are lines too – also with no guides or grid shown.
    const slide = withSlideLines(null);
    expect(withSlideLines(lines)).toEqual({ x: [0, 0.5, 1, 0.25, 0.75], y: [0, 0.5, 1, 0.5] });
    const corner = snappedToLines(
      { x: 0.012, y: 0.785, w: 0.3, h: 0.2 },
      start,
      'move',
      slide,
      tolerance,
    );
    expect(corner.rect.x).toBeCloseTo(0);
    expect(corner.rect.y + corner.rect.h).toBeCloseTo(1);
    expect(corner.caught).toBe('0,1');
    const centred = snappedToLines(
      { x: 0.36, y: 0.1, w: 0.3, h: 0.2 },
      start,
      'move',
      slide,
      tolerance,
    );
    expect(centred.rect.x + centred.rect.w / 2).toBeCloseTo(0.5);
    const right = snappedToLines(
      { x: 0.2, y: 0.2, w: 0.79, h: 0.4 },
      start,
      'se',
      slide,
      tolerance,
    );
    expect(right.rect.x + right.rect.w).toBeCloseTo(1);

    // A new box drawn (⇧ and drag): its press and its moving corner caught as a resized
    // side is, each way on its own – free (no lines), as the pointer goes.
    expect(snappedPoint({ x: 0.013, y: 0.4 }, slide, tolerance)).toEqual({
      point: { x: 0, y: 0.4 },
      caught: '0,-',
    });
    const drawn = drawnRect({ x: 0.1, y: 0.1 }, { x: 0.74, y: 0.51 }, lines, tolerance);
    expect(drawn.rect.w).toBeCloseTo(0.65);
    expect(drawn.rect.h).toBeCloseTo(0.4);
    expect(drawn.caught).toBe('0.75,0.5');
    const leftUp = drawnRect({ x: 0.6, y: 0.9 }, { x: 0.26, y: 0.3 }, lines, tolerance);
    expect(leftUp.rect).toMatchObject({ x: 0.25, y: 0.3 });
    expect(leftUp.rect.w).toBeCloseTo(0.35);
    expect(leftUp.caught).toBe('0.25,-');
    expect(drawnRect({ x: 0.1, y: 0.1 }, { x: 0.74, y: 0.51 }, null, tolerance).rect.w).toBeCloseTo(
      0.64,
    );
    // ⇧: square as seen (16:9), as far as the pointer went further – the closer catch counts,
    // the other side follows; no further than the slide's edge.
    const aspect = 16 / 9;
    const sq = drawnRect({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, null, tolerance, true, aspect);
    expect(sq.rect.w * aspect).toBeCloseTo(sq.rect.h);
    expect(sq.rect.w).toBeCloseTo(0.2);
    const sqCaught = drawnRect(
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.49 },
      lines,
      tolerance,
      true,
      aspect,
    );
    expect(sqCaught.rect.h).toBeCloseTo(0.4);
    expect(sqCaught.rect.w * aspect).toBeCloseTo(0.4);
    expect(sqCaught.caught).toBe('-,0.5');
    const edge = drawnRect({ x: 0.8, y: 0.5 }, { x: 1, y: 1 }, null, tolerance, true, aspect);
    expect(edge.rect.x + edge.rect.w).toBeCloseTo(1);
    expect(edge.rect.h).toBeCloseTo(0.2 * aspect);

    // Grown to the next lines (Anordnen): each side out to the nearest line beyond it – one on a
    // line goes on to the following one, at the slide's edge it stays; the other way as it is.
    const grid = withSlideLines(lines);
    const box2 = { x: 0.3, y: 0.1, w: 0.1, h: 0.2 };
    expect(grownToLines(box2, 'x', grid)).toEqual({ ...box2, x: 0.25, w: 0.25 });
    expect(grownToLines({ ...box2, x: 0.25, w: 0.25 }, 'x', grid)).toEqual({
      ...box2,
      x: 0,
      w: 0.75,
    });
    const tall = grownToLines(box2, 'y', grid)!;
    expect([tall.x, tall.w, tall.y, tall.h]).toEqual([0.3, 0.1, 0, 0.5]);
    // A side a hair off a line (as read back from the file) lies on it.
    expect(grownToLines({ x: 0.0001, y: 0, w: 0.4999, h: 1 }, 'x', grid)!.w).toBeCloseTo(0.75);
    // Lines off the slide are not reached; filling it already: nothing to grow.
    expect(
      grownToLines({ x: 0, y: 0, w: 1, h: 0.5 }, 'x', { x: [-0.5, 0, 1, 1.5], y: [] }),
    ).toBeNull();
    expect(grownToLines({ x: -0.2, y: 0, w: 0.4, h: 0.5 }, 'x', grid)!).toEqual({
      x: -0.2,
      y: 0,
      w: 0.45,
      h: 0.5,
    });
  });
});
