import { anchorBoxes, type Anchor, type Rect } from '@slider/shared';
import type { Thread } from '../../comments/lib/comment-selectors';

/** What was picked or drawn again: its area, and the element it is (`null`: a free area). */
export interface PickedPlace {
  slideId: string;
  rect: Rect;
  shapeId: string | null;
}

/** The place an anchor marks – its first box, or its point. `null`: the slide, a gap. */
export function placeOf(slideId: string, anchor: Anchor): PickedPlace | null {
  if (anchor.type === 'rect')
    return { slideId, rect: anchor.rect, shapeId: anchor.shapeRef?.shapeId ?? null };
  if (anchor.type === 'point')
    return {
      slideId,
      rect: { ...anchor.point, w: 0, h: 0 },
      shapeId: anchor.shapeRef?.shapeId ?? null,
    };
  return null;
}

const centre = (rect: Rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
const holds = (rect: Rect, point: { x: number; y: number }) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.w &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.h;

/** The same element (by id), or one area's centre lying in the other. */
function samePlace(a: PickedPlace, b: PickedPlace): boolean {
  if (a.shapeId !== null && a.shapeId === b.shapeId) return true;
  return holds(a.rect, centre(b.rect)) || holds(b.rect, centre(a.rect));
}

/**
 * Speaking to the AI, the place picked or drawn again is that of one's own request the AI still
 * works on (`working`): the box for the AI adds to it. The newest such thread there, else `null`.
 */
export function workingThreadAt(
  threads: readonly Thread[],
  working: ReadonlySet<string>,
  authorId: string,
  place: PickedPlace,
): Thread | null {
  let found: Thread | null = null;
  for (const thread of threads) {
    const { root } = thread;
    if (!working.has(thread.id) || root.author.id !== authorId || root.slideId !== place.slideId)
      continue;
    const boxes =
      root.anchor.type === 'point'
        ? [placeOf(place.slideId, root.anchor)!]
        : anchorBoxes(root.anchor).map((box) => ({
            slideId: place.slideId,
            rect: box.rect,
            shapeId: box.shapeRef?.shapeId ?? null,
          }));
    if (!boxes.some((box) => samePlace(box, place))) continue;
    if (!found || found.root.createdAt < root.createdAt) found = thread;
  }
  return found;
}
