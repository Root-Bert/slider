import { useLayoutEffect, useState, type RefObject } from 'react';
import { gapKey } from '../lib/comment-selectors';
import { rafThrottle } from '../lib/dom';
import { denormalizeRect, placePopover, type Placement } from '../lib/geometry';
import { useStageRegistry } from '../state/stage-registry';
import type { Draft } from '../state/viewer-state';

/** Viewport box of the draft's mark (or of the gap divider for gap comments). */
function draftTargetBox(draft: Draft, registry: ReturnType<typeof useStageRegistry>) {
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
      return denormalizeRect(anchor.rect, box);
    case 'slide':
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  }
}

/** Keeps the composer popover next to its draft while the stage scrolls or resizes. */
export function useComposerPosition(
  draft: Draft | null,
  popoverRef: RefObject<HTMLElement | null>,
) {
  const registry = useStageRegistry();
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!draft) return;
    const measure = () => {
      const target = draftTargetBox(draft, registry);
      const popover = popoverRef.current;
      if (!target || !popover) return;
      setPlacement(
        placePopover(
          target,
          { width: popover.offsetWidth, height: popover.offsetHeight },
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        ),
      );
    };
    const throttled = rafThrottle(measure);
    throttled.schedule();
    const resizeObserver = new ResizeObserver(throttled.schedule);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);
    // Capture phase catches the stage's horizontal and the page's vertical scrolling.
    window.addEventListener('scroll', throttled.schedule, { capture: true, passive: true });
    window.addEventListener('resize', throttled.schedule);
    return () => {
      throttled.cancel();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', throttled.schedule, { capture: true });
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [draft, registry, popoverRef]);

  return draft ? placement : null;
}
