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
  /**
   * Scrolls the track sideways on the app's behalf (reveals, size anchoring). Until that scroll
   * settles, `isProgrammaticScroll` is true, so scrolling doesn't pick another active slide.
   */
  scrollTrackTo: (left: number, behavior?: ScrollBehavior) => void;
  /** A programmatic scroll is still in flight (see `scrollTrackTo`). */
  isProgrammaticScroll: () => boolean;
  /** Called per scroll event: a programmatic scroll that keeps moving stays in flight. */
  noteScroll: () => void;
  /**
   * `scrollend`: over once the track arrived where it was sent – a scroll it interrupted ends
   * too, and that must not end the new one.
   */
  settleProgrammaticScroll: () => void;
  /** The user takes over (wheel, touch, scrollbar, minimap bracket). */
  endProgrammaticScroll: () => void;
}

/** Before its first scroll event a smooth scroll counts as in flight this long … */
const PROGRAMMATIC_START_MS = { smooth: 500, instant: 250 } as const;
/** … then until this long after its last scroll event (fallback where `scrollend` is missing) … */
const PROGRAMMATIC_IDLE_MS = 200;
/** … and never longer than this in all. */
const PROGRAMMATIC_MAX_MS = 3000;

export function createStageRegistry(): StageRegistry {
  let scroller: HTMLElement | null = null;
  let published: PublishedLayout | null = null;
  const find = (selector: string) => scroller?.querySelector<HTMLElement>(selector) ?? null;
  // A programmatic scroll is in flight until `until` (0 = none); `deadline` caps it.
  let until = 0;
  let deadline = 0;
  let target = 0;

  const scrollTrackTo = (left: number, behavior: ScrollBehavior = 'instant') => {
    if (!scroller || Math.abs(left - scroller.scrollLeft) < 0.5) return;
    const now = performance.now();
    until = now + PROGRAMMATIC_START_MS[behavior === 'smooth' ? 'smooth' : 'instant'];
    deadline = now + PROGRAMMATIC_MAX_MS;
    target = left;
    // Assigning scrollLeft aborts a running smooth scroll (`scrollTo` would offset it).
    if (behavior === 'smooth') scroller.scrollTo({ left, behavior });
    else scroller.scrollLeft = left;
  };

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
      scrollTrackTo(left, behavior);
    },
    scrollTrackTo,
    isProgrammaticScroll: () => until !== 0 && performance.now() < until,
    noteScroll: () => {
      if (until === 0) return;
      const now = performance.now();
      until = now < until ? Math.min(now + PROGRAMMATIC_IDLE_MS, deadline) : 0;
    },
    settleProgrammaticScroll: () => {
      if (until !== 0 && scroller && Math.abs(scroller.scrollLeft - target) <= 1) until = 0;
    },
    endProgrammaticScroll: () => {
      until = 0;
    },
  };
}

export const StageRegistryContext = createContext<StageRegistry | null>(null);

export function useStageRegistry(): StageRegistry {
  const registry = useContext(StageRegistryContext);
  if (!registry) throw new Error('useStageRegistry must be used inside <ViewerStoreProvider>');
  return registry;
}
