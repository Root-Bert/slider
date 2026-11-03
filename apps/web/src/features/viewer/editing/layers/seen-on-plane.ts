import type { Rect } from '@slider/shared';
import { projectUnitSquare, type Quad } from '../../connectors/lib/plane-projection';

/** A plane's corners as seen on screen (`PlaneCorners`). */
export function seenCorners(plane: Element): Quad | null {
  const corners = [...plane.querySelectorAll(':scope > [data-plane-corner]')].map((corner) => {
    const rect = corner.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  });
  return corners.length === 4 ? (corners as unknown as Quad) : null;
}

/** The part of the slide a plane spans (`data-box`); `null`: all of it. */
export function planeBox(plane: Element): Rect | null {
  const value = plane instanceof HTMLElement ? plane.dataset.box : undefined;
  if (!value) return null;
  const [x = 0, y = 0, w = 1, h = 1] = value.split(' ').map(Number);
  return { x, y, w, h };
}

/**
 * Where a part of the slide (`part`, 0–1) on a plane is seen on screen – the box around its four
 * corners as the plane is turned and spread, cut to `within` (what of the slide shows). `null`:
 * the plane has no corners yet, or the part lies outside.
 */
export function seenOnPlane(plane: Element, part: Rect, within: DOMRect): DOMRect | null {
  const quad = seenCorners(plane);
  if (!quad) return null;
  const box = planeBox(plane) ?? { x: 0, y: 0, w: 1, h: 1 };
  if (box.w <= 0 || box.h <= 0) return null;
  const at = projectUnitSquare(quad);
  const u = (x: number) => (x - box.x) / box.w;
  const v = (y: number) => (y - box.y) / box.h;
  const points = [
    at({ x: u(part.x), y: v(part.y) }),
    at({ x: u(part.x + part.w), y: v(part.y) }),
    at({ x: u(part.x + part.w), y: v(part.y + part.h) }),
    at({ x: u(part.x), y: v(part.y + part.h) }),
  ];
  const left = Math.max(within.left, Math.min(...points.map((p) => p.x)));
  const right = Math.min(within.right, Math.max(...points.map((p) => p.x)));
  const top = Math.max(within.top, Math.min(...points.map((p) => p.y)));
  const bottom = Math.min(within.bottom, Math.max(...points.map((p) => p.y)));
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
}
