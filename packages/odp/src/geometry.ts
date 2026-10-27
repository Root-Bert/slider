import { cm, lengthToCm } from './units';
import { attr, childrenOf, setAttr, tagOf, type XmlNode } from './xml';

/** A box in centimetres on the page. */
export interface CmBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LINE_TAGS = new Set(['draw:line', 'draw:connector', 'draw:measure']);

/** Applies `draw:transform` (rotate, translate, scale; skew is ignored) to a point. */
function transformPoint(
  transform: string,
  point: { x: number; y: number },
): { x: number; y: number } {
  let { x, y } = point;
  const steps = transform.matchAll(/(rotate|translate|scale|skewX|skewY)\s*\(([^)]*)\)/g);
  for (const [, kind, args] of steps) {
    const values = (args ?? '').trim().split(/[\s,]+/);
    if (kind === 'rotate') {
      const angle = Number(values[0]) || 0;
      // ODF rotates counter-clockwise on a y-down page.
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      [x, y] = [x * cos + y * sin, -x * sin + y * cos];
    } else if (kind === 'translate') {
      x += lengthToCm(values[0]) ?? 0;
      y += lengthToCm(values[1] ?? '0') ?? 0;
    } else if (kind === 'scale') {
      const sx = Number(values[0]) || 1;
      x *= sx;
      y *= Number(values[1] ?? values[0]) || sx;
    }
  }
  return { x, y };
}

const union = (boxes: CmBox[]): CmBox | null => {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

/** The element's axis-aligned box on the page, `null` when it has no geometry we understand. */
export function boxOf(node: XmlNode): CmBox | null {
  const tag = tagOf(node);
  if (tag === 'draw:g') {
    return union(
      childrenOf(node)
        .filter((child) => tagOf(child))
        .flatMap((child) => boxOf(child) ?? []),
    );
  }
  if (tag && LINE_TAGS.has(tag)) {
    const [x1, y1, x2, y2] = ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map((name) =>
      lengthToCm(attr(node, name)),
    );
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  const w = lengthToCm(attr(node, 'svg:width'));
  const h = lengthToCm(attr(node, 'svg:height'));
  if (w == null || h == null) return null;
  const transform = attr(node, 'draw:transform');
  if (transform) {
    const corners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
    ].map((corner) => transformPoint(transform, corner));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  const x = lengthToCm(attr(node, 'svg:x'));
  const y = lengthToCm(attr(node, 'svg:y'));
  if (x == null || y == null) return null;
  return { x, y, w, h };
}

/** Whether every part of the element sits at a plain `svg:x/y` (or line end points) – no transforms. */
export function hasPlainGeometry(node: XmlNode): boolean {
  const tag = tagOf(node);
  if (tag === 'draw:g') {
    const children = childrenOf(node).filter((child) => tagOf(child));
    return children.length > 0 && children.every(hasPlainGeometry);
  }
  if (attr(node, 'draw:transform')) return false;
  if (tag && LINE_TAGS.has(tag)) return boxOf(node) !== null;
  return ['svg:x', 'svg:y', 'svg:width', 'svg:height'].every(
    (name) => lengthToCm(attr(node, name)) != null,
  );
}

function shiftLength(node: XmlNode, name: string, delta: number): void {
  const value = lengthToCm(attr(node, name));
  if (value != null) setAttr(node, name, cm(value + delta));
}

/** Moves an element (a group with all its parts) by `dx`/`dy` centimetres. */
export function shift(node: XmlNode, dx: number, dy: number): void {
  const tag = tagOf(node);
  if (tag === 'draw:g') {
    for (const child of childrenOf(node)) if (tagOf(child)) shift(child, dx, dy);
    return;
  }
  if (tag && LINE_TAGS.has(tag)) {
    shiftLength(node, 'svg:x1', dx);
    shiftLength(node, 'svg:x2', dx);
    shiftLength(node, 'svg:y1', dy);
    shiftLength(node, 'svg:y2', dy);
    return;
  }
  shiftLength(node, 'svg:x', dx);
  shiftLength(node, 'svg:y', dy);
}

export function setBox(node: XmlNode, box: CmBox): void {
  setAttr(node, 'svg:x', cm(box.x));
  setAttr(node, 'svg:y', cm(box.y));
  setAttr(node, 'svg:width', cm(Math.max(0.01, box.w)));
  setAttr(node, 'svg:height', cm(Math.max(0.01, box.h)));
}
