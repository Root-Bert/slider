import { refShape, type Anchor, type EditableElement, type Rect, type Shape } from '@slider/shared';
import type { Thread } from '../../comments/lib/comment-selectors';

/** Shared area of two boxes over the smaller one's: 1 when one lies inside the other. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (w * h) / smaller : 0;
}

/** Below this the box a comment hangs on is not the element: it stays on top. */
const MIN_OVERLAP = 0.6;

/**
 * The element an anchor (a comment's, the draft's) hangs on, taken apart in 3D (`LayerStage`): its
 * box's element – the same id (ODP: box and element are one), else the element of that name lying
 * where the box lies, else the one covering it best. `null`: a general comment, or its box is gone
 * – on top of the stack.
 */
export function anchorElement(
  anchor: Anchor,
  elements: readonly EditableElement[],
  shapes: readonly Shape[],
): string | null {
  if (anchor.type !== 'point' && anchor.type !== 'rect') return null;
  const ref = anchor.shapeRef;
  if (!ref) return null;
  const same = elements.find((element) => element.id === ref.shapeId);
  if (same) return same.id;
  const shape = refShape(shapes, ref);
  if (!shape) return null;
  let best: { id: string; score: number } | null = null;
  for (const element of elements) {
    const score = overlap(element.bbox, shape.bbox) + (element.name === shape.name ? 1 : 0);
    if (!best || score > best.score) best = { id: element.id, score };
  }
  return best && best.score >= MIN_OVERLAP ? best.id : null;
}

/** A slide's comments by the element they hang on; `null` holds the general ones. */
export function marksByElement(
  threads: readonly Thread[],
  elements: readonly EditableElement[],
  shapes: readonly Shape[],
): Map<string | null, Thread[]> {
  const result = new Map<string | null, Thread[]>();
  for (const thread of threads) {
    const id = anchorElement(thread.root.anchor, elements, shapes);
    const list = result.get(id);
    if (list) list.push(thread);
    else result.set(id, [thread]);
  }
  return result;
}
