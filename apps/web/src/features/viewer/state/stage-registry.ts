import { createContext, useContext } from 'react';
import { revealScrollLeft, type RevealAlign, type TrackLayout } from '../lib/timeline-layout';

/** The published track layout plus what's needed to address slides in it. */
export interface PublishedLayout {
  layout: TrackLayout;
  slideIndex: ReadonlyMap<string, number>;
  /** Phones snap slide by slide: `nearest` reveals align the slide to the start instead. */
  snap: boolean;
}

export interface RevealOptions {
  behavior?: ScrollBehavior;
  align?: RevealAlign;
}

/**
 * Imperative access to the timeline DOM: scrolling slides into view and locating slide / gap
 * elements for overlays (connector lines, composer). Elements carry `data-slide-box` /
 * `data-gap-key`, so no per-slide ref bookkeeping is needed. Reveals are computed from the pure
 * layout, so they also work for slides the windowed track hasn't rendered.
 */
export interface StageRegistry {
  setScroller: (element: HTMLElement | null) => void;
  getScroller: () => HTMLElement | null;
  setLayout: (published: PublishedLayout | null) => void;
  getLayout: () => PublishedLayout | null;
  /** The slide box (image area) – the reference for all normalised coordinates. */
  getSlideElement: (slideId: string) => HTMLElement | null;
  getGapElement: (gapKey: string) => HTMLElement | null;
  revealSlide: (slideId: string, options?: RevealOptions) => void;
}

export function createStageRegistry(): StageRegistry {
  let scroller: HTMLElement | null = null;
  let published: PublishedLayout | null = null;
  const find = (selector: string) => scroller?.querySelector<HTMLElement>(selector) ?? null;

  return {
    setScroller: (element) => {
      scroller = element;
    },
    getScroller: () => scroller,
    setLayout: (next) => {
      published = next;
    },
    getLayout: () => published,
    getSlideElement: (slideId) => find(`[data-slide-box="${CSS.escape(slideId)}"]`),
    getGapElement: (gapKey) => find(`[data-gap-key="${CSS.escape(gapKey)}"]`),
    revealSlide: (slideId, { behavior = 'smooth', align = 'nearest' } = {}) => {
      const index = published?.slideIndex.get(slideId);
      if (!scroller || !published || index === undefined) return;
      const effective = published.snap && align === 'nearest' ? 'start' : align;
      const left = revealScrollLeft(
        published.layout,
        index,
        scroller.scrollLeft,
        scroller.clientWidth,
        effective,
      );
      if (Math.abs(left - scroller.scrollLeft) < 0.5) return;
      // Assigning scrollLeft aborts a running smooth scroll (`scrollTo` would offset it).
      if (behavior === 'smooth') scroller.scrollTo({ left, behavior });
      else scroller.scrollLeft = left;
    },
  };
}

export const StageRegistryContext = createContext<StageRegistry | null>(null);

export function useStageRegistry(): StageRegistry {
  const registry = useContext(StageRegistryContext);
  if (!registry) throw new Error('useStageRegistry must be used inside <ViewerStoreProvider>');
  return registry;
}
