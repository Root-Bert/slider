import type { Rect } from '@slider/shared';
import { boolAttr, child, intAttr, type XmlElement } from './xml';

/** EMU (English Metric Units): 914 400 per inch, 12 700 per point. */
export const EMU_PER_INCH = 914_400;
export const EMU_PER_POINT = 12_700;

/** A rectangle in EMU, in slide (or, inside a group, child) coordinates. */
export type EmuRect = Rect;

/**
 * Affine mapping from a coordinate space to slide space (SVG/canvas matrix convention):
 * `slideX = a·x + c·y + e`, `slideY = b·x + d·y + f`. Covers translate, scale, flips and
 * rotation, so group transforms compose exactly through nested groups.
 */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Rotation (degrees, clockwise) and flips of an `a:xfrm`. */
export interface XfrmOrientation {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

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

/** Reads `@rot` (60 000ths of a degree), `@flipH` and `@flipV` of an `a:xfrm`. */
export function readOrientation(xfrm: XmlElement | undefined): XfrmOrientation {
  return {
    rotation: (intAttr(xfrm, 'rot') ?? 0) / 60_000,
    flipH: boolAttr(xfrm, 'flipH') === true,
    flipV: boolAttr(xfrm, 'flipV') === true,
  };
}

/**
 * The transform a group (`p:grpSp`) applies to its children. The group's `a:xfrm` places the
 * child extent (`a:chOff`/`a:chExt`) onto the group's own box (`a:off`/`a:ext`), so children
 * are translated and scaled; then the group's flips mirror and its `@rot` rotates them about
 * the centre of the group box. The result is composed with the parent's transform, which makes
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
  const placement: Transform = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: box.x - (intAttr(chOff, 'x') ?? box.x) * scaleX,
    f: box.y - (intAttr(chOff, 'y') ?? box.y) * scaleY,
  };
  return compose(parent, compose(orientationAbout(box, readOrientation(xfrm)), placement));
}

/**
 * Flips, then rotates (clockwise, y pointing down) about the centre of `box`, the order in which
 * DrawingML applies an `a:xfrm`'s orientation.
 */
export function orientationAbout(box: EmuRect, orientation: XfrmOrientation): Transform {
  const { rotation, flipH, flipV } = orientation;
  if (rotation === 0 && !flipH && !flipV) return IDENTITY;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radians = (rotation * Math.PI) / 180;
  const cos = snap(Math.cos(radians));
  const sin = snap(Math.sin(radians));
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  // R · S, with R = [cos −sin; sin cos] and S = diag(sx, sy), conjugated by the centre.
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return { a, b, c, d, e: cx - a * cx - c * cy, f: cy - b * cx - d * cy };
}

/** Removes floating-point noise so multiples of 90° stay exactly axis-aligned. */
function snap(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-12 ? rounded : value;
}

/** `outer ∘ inner`: first apply `inner`, then `outer`. */
export function compose(outer: Transform, inner: Transform): Transform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/**
 * Maps `rect` (rotated by its own `rotation`, in degrees, about its centre) through `transform`
 * and returns the axis-aligned bounding box in slide space. A leaf shape's flips don't change
 * its bounding box, so only its rotation matters.
 */
export function applyTransform(transform: Transform, rect: EmuRect, rotation = 0): EmuRect {
  const own = orientationAbout(rect, { rotation, flipH: false, flipV: false });
  const matrix = own === IDENTITY ? transform : compose(transform, own);
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const px = matrix.a * x + matrix.c * y + matrix.e;
    const py = matrix.b * x + matrix.d * y + matrix.f;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** EMU rect → rect normalised to the slide size. */
export function normaliseRect(rect: EmuRect, size: { cx: number; cy: number }): Rect {
  return { x: rect.x / size.cx, y: rect.y / size.cy, w: rect.w / size.cx, h: rect.h / size.cy };
}
