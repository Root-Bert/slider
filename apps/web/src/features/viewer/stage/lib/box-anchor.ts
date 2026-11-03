import {
  anchorBoxes,
  MAX_ANCHOR_BOXES,
  shapeRefForRect,
  type Anchor,
  type AnchorBox,
  type Shape,
} from '@slider/shared';
import type { Draft } from '../../state/viewer-types';

/** A comment on a whole PowerPoint box – a click on it in box mode, or C while it is outlined. */
export const boxAnchor = (shape: Shape): Extract<Anchor, { type: 'rect' }> => ({
  type: 'rect',
  rect: shape.bbox,
  shapeRef: shapeRefForRect(shape, shape.bbox),
});

/** One comment on the boxes `boxes` (at least one): the first carries badge, line and composer. */
const anchorOfBoxes = ([first, ...more]: [AnchorBox, ...AnchorBox[]]): Anchor => ({
  type: 'rect',
  rect: first.rect,
  shapeRef: first.shapeRef,
  ...(more.length > 0 ? { more } : {}),
});

/**
 * The boxes the unsent comment on `slideId` is about – picked in box mode, one or several – or
 * `null` when it is no such comment (a pin, a free area, a drawing, text on the slide).
 */
export function draftBoxes(draft: Draft | null, slideId: string): AnchorBox[] | null {
  if (
    !draft ||
    draft.slideId !== slideId ||
    draft.anchor.type !== 'rect' ||
    !draft.anchor.shapeRef ||
    draft.anchorFromStrokes ||
    draft.textBox ||
    draft.commentId
  )
    return null;
  return anchorBoxes(draft.anchor);
}

/**
 * ⇧/⌘-click on a box in box mode, as several elements are picked while editing: the unsent comment
 * on boxes of this slide takes `shape` too, or lets it go when it has it – one comment for all of
 * them. The last box stays (the comment needs one). `null` when the draft is no comment on boxes of
 * this slide: the click starts one, as a plain click does.
 */
export function toggleDraftBox(draft: Draft | null, slideId: string, shape: Shape): Anchor | null {
  const boxes = draftBoxes(draft, slideId);
  if (!boxes || !draft) return null;
  const kept = boxes.filter((box) => box.shapeRef?.shapeId !== shape.id);
  if (kept.length === boxes.length) {
    if (boxes.length >= MAX_ANCHOR_BOXES) return draft.anchor;
    const { rect, shapeRef } = boxAnchor(shape);
    return anchorOfBoxes([...(boxes as [AnchorBox]), { rect, shapeRef }]);
  }
  return kept.length > 0 ? anchorOfBoxes(kept as [AnchorBox, ...AnchorBox[]]) : draft.anchor;
}

/**
 * A frame drawn round boxes in box mode, as a frame picks elements while editing: one comment on
 * all the boxes `shapes` it encloses, top left first (it carries badge, line and composer) – with
 * ⇧/⌘ (`add`) those the unsent comment on boxes of this slide is on stay and come first. `null`
 * when it encloses none: the frame marks the area, as before.
 */
export function framedBoxesAnchor(
  shapes: readonly Shape[],
  draft: Draft | null,
  slideId: string,
  add: boolean,
): Anchor | null {
  if (shapes.length === 0) return null;
  const kept = (add && draftBoxes(draft, slideId)) || [];
  const have = new Set(kept.map((box) => box.shapeRef?.shapeId));
  const added = [...shapes]
    .filter((shape) => !have.has(shape.id))
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((shape) => {
      const { rect, shapeRef } = boxAnchor(shape);
      return { rect, shapeRef };
    });
  const boxes = [...kept, ...added].slice(0, MAX_ANCHOR_BOXES);
  return boxes.length > 0 ? anchorOfBoxes(boxes as [AnchorBox, ...AnchorBox[]]) : null;
}
