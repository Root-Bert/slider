import type { Rect } from './flow';

/*
 * Helper lines while a box is dragged (as in Figma): its edges and middle snap to another box's
 * edges and middle within a few pixels on the screen, and a red line shows what it lines up with.
 */

export interface Guide {
  /** `x`: a vertical line at `at`; `y`: a horizontal one. */
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

const SNAP_PX = 6;

const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];

export function snapRect(
  moving: Rect,
  others: readonly Rect[],
  zoom: number,
): { dx: number; dy: number; guides: Guide[] } {
  const limit = SNAP_PX / Math.max(zoom, 0.05);
  let dx = 0;
  let bestX = limit + 1;
  let dy = 0;
  let bestY = limit + 1;
  for (const other of others) {
    for (const a of xs(moving)) {
      for (const b of xs(other)) {
        const d = b - a;
        if (Math.abs(d) < bestX && Math.abs(d) <= limit) {
          bestX = Math.abs(d);
          dx = d;
        }
      }
    }
    for (const a of ys(moving)) {
      for (const b of ys(other)) {
        const d = b - a;
        if (Math.abs(d) < bestY && Math.abs(d) <= limit) {
          bestY = Math.abs(d);
          dy = d;
        }
      }
    }
  }
  const placed = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (bestX <= limit) {
    for (const at of xs(placed)) {
      const lined = others.filter((other) => xs(other).some((b) => near(b, at)));
      if (lined.length === 0) continue;
      const all = [placed, ...lined];
      guides.push({
        axis: 'x',
        at,
        from: Math.min(...all.map((r) => r.y)),
        to: Math.max(...all.map((r) => r.y + r.height)),
      });
    }
  }
  if (bestY <= limit) {
    for (const at of ys(placed)) {
      const lined = others.filter((other) => ys(other).some((b) => near(b, at)));
      if (lined.length === 0) continue;
      const all = [placed, ...lined];
      guides.push({
        axis: 'y',
        at,
        from: Math.min(...all.map((r) => r.x)),
        to: Math.max(...all.map((r) => r.x + r.width)),
      });
    }
  }
  return { dx, dy, guides };
}
