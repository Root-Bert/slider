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
  /**
   * The slide a smooth `scrollToSlide` is still heading for, or null once the stage has settled
   * (or the user took over). Mid-animation the active slide lags behind, so zoom anchoring and
   * ←/→ go by this instead.
   */
  getScrollTarget: () => string | null;
}

/** Fallback for browsers without `scrollend`: a smooth slide scroll is done by then. */
const SCROLL_SETTLE_MS = 1000;
/** User input on the stage that interrupts a programmatic smooth scroll. */
const TAKEOVER_EVENTS = ['wheel', 'pointerdown', 'touchstart'] as const;

/** ⌘/Ctrl + wheel zooms (useStageZoom) instead of scrolling, so it keeps the target. */
const isZoomWheel = (event: Event) =>
  event instanceof WheelEvent && (event.ctrlKey || event.metaKey);

export function createStageRegistry(): StageRegistry {
  let scroller: HTMLElement | null = null;
  let target: string | null = null;
  let settleTimer = 0;
  const find = (selector: string) => scroller?.querySelector<HTMLElement>(selector) ?? null;
  const clearTarget = () => {
    target = null;
    window.clearTimeout(settleTimer);
  };
  const onTakeover = (event: Event) => {
    if (!isZoomWheel(event)) clearTarget();
  };
  const supportsScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window;

  return {
    setScroller: (element) => {
      if (scroller) {
        scroller.removeEventListener('scrollend', clearTarget);
        for (const type of TAKEOVER_EVENTS) scroller.removeEventListener(type, onTakeover);
      }
      clearTarget();
      scroller = element;
      if (scroller) {
        scroller.addEventListener('scrollend', clearTarget);
        for (const type of TAKEOVER_EVENTS)
          scroller.addEventListener(type, onTakeover, { passive: true });
      }
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
      const left = scroller.scrollLeft + offset - paddingLeft;
      clearTarget();
      // Already there: no scroll happens, so no `scrollend` would clear the target.
      if (behavior === 'smooth' && Math.abs(left - scroller.scrollLeft) >= 1) {
        target = slideId;
        if (!supportsScrollEnd) settleTimer = window.setTimeout(clearTarget, SCROLL_SETTLE_MS);
      }
      if (behavior === 'smooth') scroller.scrollTo({ left, behavior });
      // Chrome treats an instant `scrollTo` during a running smooth scroll as an offset to that
      // animation, which then ends off the snap point (e.g. when zooming right after a thumbnail
      // click). Assigning `scrollLeft` aborts the animation (the stage has no CSS smooth scroll).
      else scroller.scrollLeft = left;
    },
    getScrollTarget: () => target,
  };
}

export const StageRegistryContext = createContext<StageRegistry | null>(null);

export function useStageRegistry(): StageRegistry {
  const registry = useContext(StageRegistryContext);
  if (!registry) throw new Error('useStageRegistry must be used inside <ViewerStoreProvider>');
  return registry;
}
