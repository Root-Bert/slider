import { clampPoint, type Point, type Rect } from '@slider/shared';

/** The subset of `DOMRect` we need – keeps the pure helpers testable without a DOM. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Converts a viewport position into normalised slide coordinates (clamped to 0–1). */
export function normalizeClientPoint(clientX: number, clientY: number, box: ClientRect): Point {
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return clampPoint({ x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height });
}

/** The one place that turns a pointer event into slide coordinates (BER-96, BER-98). */
export const toSlidePoint = (
  event: { clientX: number; clientY: number },
  slideElement: Element,
): Point =>
  normalizeClientPoint(event.clientX, event.clientY, slideElement.getBoundingClientRect());

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
  side: 'right' | 'left' | 'below';
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
