import { createContext, useContext } from 'react';

/**
 * Imperative access to the stage DOM: scrolling to slides and locating slide / gap elements for
 * overlays (connector lines, composer). Elements carry `data-slide-id` / `data-gap-key`, so no
 * per-slide ref bookkeeping is needed.
 */
export interface StageRegistry {
  setScroller: (element: HTMLElement | null) => void;
  getScroller: () => HTMLElement | null;
  /** The slide box (image area) – the reference for all normalised coordinates. */
  getSlideElement: (slideId: string) => HTMLElement | null;
  getGapElement: (gapKey: string) => HTMLElement | null;
  scrollToSlide: (slideId: string, behavior?: ScrollBehavior) => void;
}

export function createStageRegistry(): StageRegistry {
  let scroller: HTMLElement | null = null;
  const find = (selector: string) => scroller?.querySelector<HTMLElement>(selector) ?? null;

  return {
    setScroller: (element) => {
      scroller = element;
    },
    getScroller: () => scroller,
    getSlideElement: (slideId) => find(`[data-slide-box="${CSS.escape(slideId)}"]`),
    getGapElement: (gapKey) => find(`[data-gap-key="${CSS.escape(gapKey)}"]`),
    scrollToSlide: (slideId, behavior = 'smooth') => {
      const item = find(`[data-slide-id="${CSS.escape(slideId)}"]`);
      if (!scroller || !item) return;
      // Scroll only the stage horizontally – `scrollIntoView` would also move the page vertically.
      const offset = item.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
      const paddingLeft = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
      scroller.scrollTo({ left: scroller.scrollLeft + offset - paddingLeft, behavior });
    },
  };
}

export const StageRegistryContext = createContext<StageRegistry | null>(null);

export function useStageRegistry(): StageRegistry {
  const registry = useContext(StageRegistryContext);
  if (!registry) throw new Error('useStageRegistry must be used inside <ViewerStoreProvider>');
  return registry;
}
