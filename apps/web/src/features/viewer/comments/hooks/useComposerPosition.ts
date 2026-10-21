import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { gapKey } from '../lib/comment-selectors';
import { denormalizeRect, placePopover, type Placement } from '../../lib/geometry';
import { useMarkPreview, useStageRegistry, type MarkPreview } from '../../state/stage-registry';
import type { Draft } from '../../state/viewer-state';

/** Viewport box of the draft's mark (or of the gap divider for gap comments). */
function draftTargetBox(
  draft: Draft,
  registry: ReturnType<typeof useStageRegistry>,
  preview: MarkPreview | null,
) {
  const { anchor } = draft;
  if (anchor.type === 'gap') {
    const element = registry.getGapElement(gapKey(anchor.afterSlideId, anchor.beforeSlideId));
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    return { left: box.left, right: box.right, top: middle - 20, bottom: middle + 20 };
  }
  const slide = draft.slideId ? registry.getSlideElement(draft.slideId) : null;
  if (!slide) return null;
  const box = slide.getBoundingClientRect();
  switch (anchor.type) {
    case 'point':
      return denormalizeRect({ ...anchor.point, w: 0, h: 0 }, box);
    case 'rect':
      // While the box is dragged, its shown place – not the stored one.
      return denormalizeRect(preview?.threadId === null ? preview.rect : anchor.rect, box);
    case 'slide':
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }
}

/**
 * Keeps the composer popover next to its draft while the stage scrolls or resizes. Scrolling and
 * resizing re-place it right away and commit before the frame paints: a frame requested from
 * there lands a frame late, and the popover trails its mark.
 */
export function useComposerPosition(
  draft: Draft | null,
  popoverRef: RefObject<HTMLElement | null>,
) {
  const registry = useStageRegistry();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const preview = useMarkPreview();

  useLayoutEffect(() => {
    if (!draft) return;
    const place = () => {
      const target = draftTargetBox(draft, registry, preview);
      const popover = popoverRef.current;
      if (!target || !popover) return;
      const next = placePopover(
        target,
        { width: popover.offsetWidth, height: popover.offsetHeight },
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      );
      setPlacement((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.side === next.side
          ? current
          : next,
      );
    };
    const placeNow = () => flushSync(place);
    // Placed before the first paint, so it shows up together with its mark, not a frame after.
    place();
    const resizeObserver = new ResizeObserver(placeNow);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);
    // The slide resizes under a split drag or a zoom without anything scrolling.
    const slide = draft.slideId ? registry.getSlideElement(draft.slideId) : null;
    if (slide) resizeObserver.observe(slide);
    // Capture phase catches the stage's horizontal and the page's vertical scrolling.
    window.addEventListener('scroll', placeNow, { capture: true, passive: true });
    window.addEventListener('resize', placeNow);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', placeNow, { capture: true });
      window.removeEventListener('resize', placeNow);
    };
  }, [draft, registry, popoverRef, preview]);

  return draft ? placement : null;
}
