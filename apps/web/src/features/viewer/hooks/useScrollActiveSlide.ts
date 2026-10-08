import { useEffect, useEffectEvent, type RefObject } from 'react';
import { rafThrottle } from '../lib/dom';
import { pickActiveSlide } from '../lib/scroll-active';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Scrolling the timeline sideways – wheel, trackpad, scrollbar, swipe, minimap bracket – makes
 * the slide most in view active (`lib/scroll-active`), live once per frame; the URL follows via
 * `useSlideUrlSync`. It stays put
 * - while a programmatic scroll (click, ←/→, counter, deep link, thread panel) is in flight, so a
 *   reveal lands on its target instead of passing through other slides,
 * - while a drawing tool or a draft is active, so a draft stays on its slide,
 * - when only the comment area scrolls (vertically).
 */
export function useScrollActiveSlide(scrollerRef: RefObject<HTMLElement | null>) {
  const { slides } = useViewerData();
  const { activeSlideId, tool, draft } = useViewerState();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();

  const pick = useEffectEvent(() => {
    const scroller = scrollerRef.current;
    const published = registry.getLayout();
    if (!scroller || !published || tool !== null || draft !== null) return;
    if (registry.isProgrammaticScroll()) return;
    const current = activeSlideId ? (published.slideIndex.get(activeSlideId) ?? null) : null;
    const index = pickActiveSlide({
      slides: published.layout.slides,
      scrollLeft: scroller.scrollLeft,
      viewportW: scroller.clientWidth,
      maxScroll: scroller.scrollWidth - scroller.clientWidth,
      current,
    });
    const slide = index === null ? undefined : slides[index];
    if (slide && slide.id !== activeSlideId)
      dispatch({ type: 'activeSlideChanged', slideId: slide.id });
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let lastLeft = scroller.scrollLeft;
    const update = rafThrottle(pick);

    const onScroll = () => {
      const left = scroller.scrollLeft;
      // Vertical only: the comment area scrolled.
      if (Math.abs(left - lastLeft) < 0.5) return;
      lastLeft = left;
      if (registry.isProgrammaticScroll()) {
        registry.noteScroll();
        update.cancel();
        return;
      }
      update.schedule();
    };
    const onScrollEnd = () => registry.settleProgrammaticScroll();
    // The user takes over a programmatic scroll: sideways wheel (or any wheel over the header,
    // which scrolls the track), a swipe, or the scrollbar.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const overHeader =
        event.target instanceof Element && event.target.closest('[data-timeline-header]');
      if (overHeader || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        registry.endProgrammaticScroll();
    };
    const onTouchStart = () => registry.endProgrammaticScroll();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === scroller) registry.endProgrammaticScroll();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('scrollend', onScrollEnd);
    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('pointerdown', onPointerDown);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('scrollend', onScrollEnd);
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('pointerdown', onPointerDown);
      update.cancel();
    };
  }, [scrollerRef, registry]);
}
