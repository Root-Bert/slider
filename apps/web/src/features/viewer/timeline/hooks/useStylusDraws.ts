import { useEffect, type RefObject } from 'react';
import { isTextTarget } from '@/lib/dom';

/** Where a pen draws: a slide, flat or taken apart (`SlideFrame`, `LayerStage`). */
const ON_SLIDE = '[data-slide-box], [data-layer-stage]';

/**
 * A pen on the slides draws – a comment's frame, a frame round elements while editing – and the
 * finger scrolls, as Figma and Notes have it on an iPad. Safari pans under an Apple Pencil too and
 * cancels its pointer (`pointercancel`) before a frame is drawn; `touch-action` can't tell a pen
 * from a finger, so the pen's moves are held here. Only moves: its tap still clicks (a pin lands
 * as with a finger), and in a field it writes (Scribble).
 */
export function useStylusDraws(scrollerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const hold = (event: TouchEvent) => {
      // Safari's `touchType` („stylus“, „direct“) – not in TypeScript's DOM types.
      const touch = event.touches[0] as (Touch & { touchType?: string }) | undefined;
      if (event.touches.length !== 1 || touch?.touchType !== 'stylus') return;
      if (isTextTarget(event.target) || !event.cancelable) return;
      // On a slide only: between the slides and on the comments the pen scrolls as a finger.
      if (!(event.target instanceof Element) || !event.target.closest(ON_SLIDE)) return;
      event.preventDefault();
    };
    scroller.addEventListener('touchmove', hold, { passive: false });
    return () => scroller.removeEventListener('touchmove', hold);
  }, [scrollerRef]);
}
