import type { Rect } from '@slider/shared';
import { child, intAttr, type XmlElement } from './xml';

/** EMU (English Metric Units): 914 400 per inch, 12 700 per point. */
export const EMU_PER_INCH = 914_400;
export const EMU_PER_POINT = 12_700;

/** A rectangle in EMU, in slide (or, inside a group, child) coordinates. */
export type EmuRect = Rect;

/**
 * Affine mapping from a coordinate space to slide space, axis-aligned (no rotation):
 * `slideX = x * scaleX + offsetX`.
 */
export interface Transform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY: Transform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

/** Reads `a:off` / `a:ext` of an `a:xfrm` (or `p:xfrm`) element; `null` if incomplete. */
export function readXfrm(xfrm: XmlElement | undefined): EmuRect | null {
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  const x = intAttr(off, 'x');
  const y = intAttr(off, 'y');
  const w = intAttr(ext, 'cx');
  const h = intAttr(ext, 'cy');
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h };
}

/**
 * The transform a group (`p:grpSp`) applies to its children. The group's `a:xfrm` places the
 * child extent (`a:chOff`/`a:chExt`) onto the group's own box (`a:off`/`a:ext`), so children
 * are translated and scaled. The result is composed with the parent's transform, which makes
 * nested groups work.
 */
export function groupTransform(xfrm: XmlElement | undefined, parent: Transform): Transform {
  const box = readXfrm(xfrm);
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  if (!box) return parent;
  const childW = intAttr(chExt, 'cx') ?? box.w;
  const childH = intAttr(chExt, 'cy') ?? box.h;
  const scaleX = childW === 0 ? 1 : box.w / childW;
  const scaleY = childH === 0 ? 1 : box.h / childH;
  const local: Transform = {
    scaleX,
    scaleY,
    offsetX: box.x - (intAttr(chOff, 'x') ?? box.x) * scaleX,
    offsetY: box.y - (intAttr(chOff, 'y') ?? box.y) * scaleY,
  };
  return compose(parent, local);
}

/** `outer ∘ inner`: first apply `inner`, then `outer`. */
export function compose(outer: Transform, inner: Transform): Transform {
  return {
    scaleX: outer.scaleX * inner.scaleX,
    scaleY: outer.scaleY * inner.scaleY,
    offsetX: inner.offsetX * outer.scaleX + outer.offsetX,
    offsetY: inner.offsetY * outer.scaleY + outer.offsetY,
  };
}

export function applyTransform(transform: Transform, rect: EmuRect): EmuRect {
  return {
    x: rect.x * transform.scaleX + transform.offsetX,
    y: rect.y * transform.scaleY + transform.offsetY,
    w: rect.w * transform.scaleX,
    h: rect.h * transform.scaleY,
  };
}

/** EMU rect → rect normalised to the slide size. */
export function normaliseRect(rect: EmuRect, size: { cx: number; cy: number }): Rect {
  return { x: rect.x / size.cx, y: rect.y / size.cy, w: rect.w / size.cx, h: rect.h / size.cy };
}
