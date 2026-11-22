import { clampPointIn, SLIDE_RECT, type Point, type Rect } from '@slider/shared';

/** The subset of `DOMRect` we need – keeps the pure helpers testable without a DOM. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a viewport position into normalised slide coordinates, kept inside `room` (the slide,
 * 0–1, unless there is room around it: `slideRoom`).
 */
export function normalizeClientPoint(
  clientX: number,
  clientY: number,
  box: ClientRect,
  room: Rect = SLIDE_RECT,
): Point {
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return clampPointIn(
    { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height },
    room,
  );
}

/**
 * Where things may lie on and around a slide, in its coordinates: the slide itself, and – zoomed
 * out – what its frame (`data-slide-frame`) shows around it, as Figma's canvas round a frame.
 * `slideElement`: the slide's box or a layer as large as it.
 */
export function slideRoom(slideElement: Element): Rect {
  const frame = slideElement.closest('[data-slide-frame]');
  const box = slideElement.getBoundingClientRect();
  if (!frame || box.width === 0 || box.height === 0) return SLIDE_RECT;
  const around = frame.getBoundingClientRect();
  // A rounding error over the slide's edge is no room.
  const before = (edge: number) => (edge < -1e-3 ? edge : 0);
  const after = (edge: number) => (edge > 1 + 1e-3 ? edge : 1);
  const left = before((around.left - box.left) / box.width);
  const top = before((around.top - box.top) / box.height);
  const right = after((around.right - box.left) / box.width);
  const bottom = after((around.bottom - box.top) / box.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The one place that turns a pointer event into slide coordinates (BER-96, BER-98): on the slide,
 * or – zoomed out – in the room around it (`slideRoom`).
 */
export const toSlidePoint = (
  event: { clientX: number; clientY: number },
  slideElement: Element,
): Point =>
  normalizeClientPoint(
    event.clientX,
    event.clientY,
    slideElement.getBoundingClientRect(),
    slideRoom(slideElement),
  );

/** Inverse: a normalised rect on a slide to a viewport box. */
export function denormalizeRect(rect: Rect, box: ClientRect) {
  const left = box.left + rect.x * box.width;
  const top = box.top + rect.y * box.height;
  return { left, top, right: left + rect.w * box.width, bottom: top + rect.h * box.height };
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  side: 'right' | 'left' | 'below' | 'above';
}

/**
 * Places a popover under a target box if it fits there, else over it – where there is more room
 * when it fits neither (it then overlaps, clamped into the viewport) – centred on it, clamped
 * into the viewport with a margin.
 */
export function placeBelowOrAbove(
  target: { left: number; top: number; right: number; bottom: number },
  popover: Size,
  viewport: Size,
  gap = 16,
  margin = 12,
): Placement {
  const left = Math.max(
    margin,
    Math.min(
      (target.left + target.right) / 2 - popover.width / 2,
      viewport.width - popover.width - margin,
    ),
  );
  const below = target.bottom + gap;
  const above = target.top - gap - popover.height;
  const fitsBelow = below + popover.height + margin <= viewport.height;
  const fitsAbove = above >= margin;
  const side =
    fitsBelow || (!fitsAbove && viewport.height - target.bottom >= target.top) ? 'below' : 'above';
  const top = Math.max(
    margin,
    Math.min(side === 'below' ? below : above, viewport.height - popover.height - margin),
  );
  return { left, top, side };
}

/**
 * Places a popover next to a target box: to the right if it fits, else to the left, else below –
 * always clamped into the viewport with a margin.
 */
export function placePopover(
  target: { left: number; top: number; right: number; bottom: number },
  popover: Size,
  viewport: Size,
  gap = 12,
  margin = 12,
): Placement {
  const clampTop = (top: number) =>
    Math.max(margin, Math.min(top, viewport.height - popover.height - margin));
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, viewport.width - popover.width - margin));

  if (target.right + gap + popover.width + margin <= viewport.width) {
    return { left: target.right + gap, top: clampTop(target.top), side: 'right' };
  }
  if (target.left - gap - popover.width >= margin) {
    return { left: target.left - gap - popover.width, top: clampTop(target.top), side: 'left' };
  }
  return { left: clampLeft(target.left), top: clampTop(target.bottom + gap), side: 'below' };
}
