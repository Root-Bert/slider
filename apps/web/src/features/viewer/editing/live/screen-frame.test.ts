import { describe, expect, it } from 'vitest';
import { toLocal, type ScreenFrame } from './screen-frame';

/** A box's pixels on screen: at (200, 100), `scale` times as large, turned by `degrees`. */
function frameOf(degrees: number, scale = 1): ScreenFrame {
  const angle = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return {
    origin: { x: 200, y: 100 },
    u: { x: cos * scale, y: sin * scale },
    v: { x: -sin * scale, y: cos * scale },
  };
}

/** What the browser gives for a box of the text: the screen box around it, turned. */
function onScreen(frame: ScreenFrame, box: { x: number; y: number; w: number; h: number }) {
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => ({
    x: frame.origin.x + x! * frame.u.x + y! * frame.v.x,
    y: frame.origin.y + x! * frame.u.y + y! * frame.v.y,
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

const close = (actual: Record<string, number>, expected: Record<string, number>) => {
  for (const key of Object.keys(expected)) expect(actual[key]).toBeCloseTo(expected[key]!, 3);
};

describe('the others’ carets on a turned box', () => {
  const selection = { x: 30, y: 12, w: 80, h: 18 };
  const caret = { x: 42, y: 40, w: 0, h: 18 };

  it('maps a selection and a caret back into a turned, zoomed box', () => {
    for (const degrees of [0, 30, -20, 90, 150, 200]) {
      const frame = frameOf(degrees, 1.7);
      close(toLocal(frame, onScreen(frame, selection), { lineHeight: 18 }), selection);
      close(toLocal(frame, onScreen(frame, caret), { caret: true }), caret);
    }
    // Near 45° the box around it does not tell the line's height; the given one is taken.
    const frame = frameOf(45, 1.2);
    close(toLocal(frame, onScreen(frame, selection), { lineHeight: 18 }), selection);
  });
});
