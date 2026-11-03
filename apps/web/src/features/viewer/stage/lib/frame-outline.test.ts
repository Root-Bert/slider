import { describe, expect, it } from 'vitest';
import { CORNER_HALF, DOME_RADIUS, frameOutline, handleMarks } from './frame-outline';

const ALL = ['nw', 'ne', 'se', 'sw'] as const;
const moves = (path: string) => path.match(/M/g)?.length ?? 0;

describe('frameOutline', () => {
  it('runs out around every handle in one stroke, keeping flat and narrow boxes as they are', () => {
    expect(frameOutline(200, 100, [], false)).toBe('M0 0 L200 0 L200 100 L0 100 Z');
    const line = frameOutline(200, 100, ALL, true);
    expect(moves(line)).toBe(1);
    expect(line).toContain(`A${DOME_RADIUS} ${DOME_RADIUS}`);
    // Out to the brackets' far sides.
    expect(line).toContain(`${-CORNER_HALF}`);
    expect(line).toContain(`${200 + CORNER_HALF}`);
    // Too narrow for the dome: it gets its own one.
    expect(moves(frameOutline(20, 100, ALL, true))).toBe(2);
    // Flat: its brackets get shorter inwards, not the box larger.
    const flat = frameOutline(200, 6, ALL, false);
    const ys = [...flat.matchAll(/[MLQ](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    // Out to the brackets' far sides, no farther.
    expect(Math.min(...ys)).toBe(-CORNER_HALF);
    expect(Math.max(...ys)).toBe(6 + CORNER_HALF);
    expect(moves(flat)).toBe(1);
    // A triangle's frame: the handles alone, each a stroke of its own, no box line between them.
    const marks = handleMarks(200, 100, ALL, true);
    expect(moves(marks)).toBe(5);
    expect(marks).not.toContain('Z M');
    expect(marks).not.toContain('L200 0 ');
    // Closed ones (the pointer far away) draw nothing, no dot off the shape.
    expect(handleMarks(200, 100, ALL, true, { nw: 0, ne: 0, se: 0, sw: 0, turn: 0 })).toBe('');
  });

  it('grows brackets and the dome out of the box as they open', () => {
    const xs = (open: number) =>
      [...frameOutline(200, 100, ['nw'], false, { nw: open }).matchAll(/[MLQ](-?[\d.]+) /g)].map(
        (m) => Number(m[1]),
      );
    // Closed: no farther out than the box.
    expect(Math.min(...xs(0))).toBe(0);
    expect(Math.min(...xs(0.5))).toBe(-CORNER_HALF / 2);
    expect(Math.min(...xs(1))).toBe(-CORNER_HALF);
    expect(frameOutline(200, 100, [], true, { turn: 0 })).toBe(frameOutline(200, 100, [], false));
    expect(frameOutline(200, 100, [], true, { turn: 0.5 })).toContain(
      `A${DOME_RADIUS / 2} ${DOME_RADIUS / 2}`,
    );
  });
});
