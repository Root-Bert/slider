import type { Rect } from '@slider/shared';

/** Pure geometry of moving and resizing a box on the slide (normalised 0–1 coordinates). */

export type RectCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface RectSize {
  w: number;
  h: number;
}

/** Smallest box a resize leaves, relative to the slide. */
export const MIN_RECT_SIZE: RectSize = { w: 0.02, h: 0.02 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `start` moved by the pointer delta (`dx`, `dy` relative to the slide), kept on the slide. */
export function moved(start: Rect, dx: number, dy: number): Rect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

/** `start` with `corner` dragged to (`px`, `py`), the opposite corner fixed. */
export function resized(
  start: Rect,
  corner: RectCorner,
  px: number,
  py: number,
  min: RectSize = MIN_RECT_SIZE,
): Rect {
  const x = clamp(px, 0, 1);
  const y = clamp(py, 0, 1);
  let { x: left, y: top } = start;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (corner === 'nw' || corner === 'sw') left = Math.min(x, right - min.w);
  else right = Math.max(x, left + min.w);
  if (corner === 'nw' || corner === 'ne') top = Math.min(y, bottom - min.h);
  else bottom = Math.max(y, top + min.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
