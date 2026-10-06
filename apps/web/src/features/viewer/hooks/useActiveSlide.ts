import { useEffect, type RefObject } from 'react';
import { useViewerDispatch } from '../state/viewer-state';

/**
 * Derives the active slide from the stage's scroll position (BER-95). An IntersectionObserver
 * watches a band along the left half of the stage; the slide covering most of it is active.
 * No scroll listeners, so long decks stay smooth.
 */
export function useActiveSlide(
  scrollerRef: RefObject<HTMLElement | null>,
  slideIds: readonly string[],
) {
  const dispatch = useViewerDispatch();

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const visibleWidth = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slideId = (entry.target as HTMLElement).dataset.slideId;
          if (!slideId) continue;
          if (entry.isIntersecting) visibleWidth.set(slideId, entry.intersectionRect.width);
          else visibleWidth.delete(slideId);
        }
        let best: string | null = null;
        let bestWidth = 0;
        // Iterating in deck order makes ties go to the earlier slide.
        for (const slideId of slideIds) {
          const width = visibleWidth.get(slideId) ?? 0;
          if (width > bestWidth) {
            best = slideId;
            bestWidth = width;
          }
        }
        if (best) dispatch({ type: 'activeSlideChanged', slideId: best });
      },
      { root: scroller, rootMargin: '0px -50% 0px 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    scroller
      .querySelectorAll<HTMLElement>('[data-slide-id]')
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [scrollerRef, slideIds, dispatch]);
}
