import type { LiveCursor } from '@slider/shared';
import { toSlidePoint } from '../lib/geometry';

/**
 * Pointers are shared over the slides only (BER-104): normalised to the slide box, they land on
 * the same spot whatever size each viewer's window gives the slide.
 */

/** The pointer at (`x`, `y`) over `target`, or `null` when it is not over a slide. */
export function locateCursor(target: Element | null, x: number, y: number): LiveCursor | null {
  const box = target?.closest<HTMLElement>('[data-slide-box]');
  const slideId = box?.dataset['slideBox'];
  if (!box || !slideId) return null;
  return { slideId, point: toSlidePoint({ clientX: x, clientY: y }, box) };
}

/** Same position, so an unchanged pointer is not posted again. */
export const sameCursor = (a: LiveCursor | null, b: LiveCursor | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.slideId === b.slideId &&
    a.point.x === b.point.x &&
    a.point.y === b.point.y);
