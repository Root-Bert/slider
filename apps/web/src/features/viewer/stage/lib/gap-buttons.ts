import { isPendingSlideId } from '../../editing/pending-slides';

/** The gap's buttons: who may insert (and pick the transition after it) and comment there. */
export function gapButtons({
  afterSlideId,
  beforeSlideId,
  canInsert: insertable,
  canComment: commentable,
}: {
  afterSlideId: string | null;
  beforeSlideId: string | null;
  canInsert: boolean;
  canComment: boolean;
}) {
  // Beside a slide just put in, not on the server yet: nothing to name it by until it is.
  const settled = ![afterSlideId, beforeSlideId].some((id) => id && isPendingSlideId(id));
  const canInsert = insertable && settled;
  const canComment = commentable && settled;
  const canTransition = canInsert && beforeSlideId !== null;
  const count = Number(canInsert && !!afterSlideId) + Number(canTransition) + Number(canComment);
  return { canInsert, canComment, canTransition, count };
}

/**
 * How far the track dots' bottom lies over the gap's middle (px): over its `count` buttons
 * (centred there, `size-6`/`size-5` with `gap-2`), 8px apart – on every track alike, so the dots
 * stay put when the band swipes to one without the buttons.
 */
export function gapDotsLift(count: number, width: number): number {
  const button = width < 32 ? 20 : 24;
  return (count > 0 ? (count * button + (count - 1) * 8) / 2 : 0) + 8;
}
