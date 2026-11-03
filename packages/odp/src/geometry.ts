import { cm, lengthToCm } from './units';
import { attr, childrenOf, removeAttr, setAttr, tagOf, type XmlNode } from './xml';

/** A box in centimetres on the page. */
export interface CmBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LINE_TAGS = new Set(['draw:line', 'draw:connector', 'draw:measure']);

/** A point turned by `angle` (radians) around the origin – ODF's way: counter-clockwise on a y-down page. */
function rotated(point: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos + point.y * sin, y: -point.x * sin + point.y * cos };
}

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
      ({ x, y } = rotated({ x, y }, angle));
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

/**
 * Moves an element by `dx`/`dy` centimetres wherever its place is kept: a turned (transformed)
 * shape by one more `translate` at the end of its `draw:transform`, else as `shift` does.
 */
export function moveBy(node: XmlNode, dx: number, dy: number): void {
  const tag = tagOf(node);
  if (tag === 'draw:g') {
    for (const child of childrenOf(node)) if (tagOf(child)) moveBy(child, dx, dy);
    return;
  }
  const transform = attr(node, 'draw:transform');
  if (transform && !(tag && LINE_TAGS.has(tag))) {
    setAttr(node, 'draw:transform', `${transform} translate (${cm(dx)} ${cm(dy)})`);
    return;
  }
  shift(node, dx, dy);
}

export function setBox(node: XmlNode, box: CmBox): void {
  setAttr(node, 'svg:x', cm(box.x));
  setAttr(node, 'svg:y', cm(box.y));
  setAttr(node, 'svg:width', cm(Math.max(0.01, box.w)));
  setAttr(node, 'svg:height', cm(Math.max(0.01, box.h)));
}

/** An element as the editor moves, sizes and turns it: its box before the turn, and the turn. */
export interface Frame {
  box: CmBox;
  /** Degrees clockwise as seen, around the box's centre, 0 ≤ rotation < 360. */
  rotation: number;
}

/** Below this (degrees) a turn is none. */
const NO_TURN = 0.01;

const normalized = (degrees: number): number => {
  const turn = ((degrees % 360) + 360) % 360;
  return turn < NO_TURN || 360 - turn < NO_TURN ? 0 : Number(turn.toFixed(4));
};

/**
 * `draw:transform` as LibreOffice writes a turned shape – `rotate (a) translate (x y)`, maybe
 * after a `skewX` of nothing – as its angle (radians) and offset (cm); `null` for anything else.
 */
function turnOf(transform: string): { angle: number; x: number; y: number } | null {
  let angle = 0;
  // Summed moves; `moved` once there is one (TS narrows a `let … | null` to `null` in the loop).
  let moved = false;
  let dx = 0;
  let dy = 0;
  const steps = [...transform.matchAll(/(\w+)\s*\(([^)]*)\)/g)];
  const rest = transform.replace(/(\w+)\s*\(([^)]*)\)/g, '').trim();
  if (rest) return null;
  for (const [, kind, args] of steps) {
    const values = (args ?? '').trim().split(/[\s,]+/);
    // Only further moves after the move (`moveBy` adds one each time).
    if (moved && kind !== 'translate') return null;
    if (kind === 'skewX' || kind === 'skewY') {
      if (Math.abs(Number(values[0]) || 0) > 1e-9) return null;
    } else if (kind === 'rotate') {
      angle += Number(values[0]) || 0;
    } else if (kind === 'translate') {
      const x = lengthToCm(values[0]);
      const y = lengthToCm(values[1] ?? '0');
      if (x == null || y == null) return null;
      moved = true;
      dx += x;
      dy += y;
    } else return null;
  }
  return moved ? { angle, x: dx, y: dy } : null;
}

/**
 * The element's frame when the editor can move it: placed plainly, or a shape only turned (not
 * skewed or scaled); `null` otherwise. Groups and lines are never turned.
 */
export function frameOf(node: XmlNode): Frame | null {
  const tag = tagOf(node);
  const transform = attr(node, 'draw:transform');
  // A group: the box round its parts, each of which has a place (a turned one too).
  if (tag === 'draw:g') {
    const box = groupPlaced(node) ? boxOf(node) : null;
    return box && { box, rotation: 0 };
  }
  if (!transform || (tag && LINE_TAGS.has(tag))) {
    const box = hasPlainGeometry(node) ? boxOf(node) : null;
    return box && { box, rotation: 0 };
  }
  const w = lengthToCm(attr(node, 'svg:width'));
  const h = lengthToCm(attr(node, 'svg:height'));
  const turn = turnOf(transform);
  if (w == null || h == null || !turn) return null;
  const centre = rotated({ x: w / 2, y: h / 2 }, turn.angle);
  return {
    box: { x: centre.x + turn.x - w / 2, y: centre.y + turn.y - h / 2, w, h },
    rotation: normalized((-turn.angle * 180) / Math.PI),
  };
}

/** Whether every part of a group has a place `frameOf` reads (groups in it too). */
function groupPlaced(node: XmlNode): boolean {
  const children = childrenOf(node).filter((child) => tagOf(child));
  return (
    children.length > 0 &&
    children.every((child) => (tagOf(child) === 'draw:g' ? groupPlaced(child) : frameOf(child)))
  );
}

/** Places a shape (not a group or line) by its frame: a turn as `draw:transform`, else plainly. */
export function setFrame(node: XmlNode, { box, rotation }: Frame): void {
  const turn = normalized(rotation);
  if (turn === 0) {
    removeAttr(node, 'draw:transform');
    setBox(node, box);
    return;
  }
  const w = Math.max(0.01, box.w);
  const h = Math.max(0.01, box.h);
  const angle = (-turn * Math.PI) / 180;
  const centre = rotated({ x: w / 2, y: h / 2 }, angle);
  const x = box.x + w / 2 - centre.x;
  const y = box.y + h / 2 - centre.y;
  removeAttr(node, 'svg:x');
  removeAttr(node, 'svg:y');
  setAttr(node, 'svg:width', cm(w));
  setAttr(node, 'svg:height', cm(h));
  setAttr(
    node,
    'draw:transform',
    `rotate (${Number(angle.toFixed(10))}) translate (${cm(x)} ${cm(y)})`,
  );
}
