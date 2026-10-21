import { useLayoutEffect, useState, type RefObject } from 'react';

export interface TimelineMetrics {
  /** Width the geometry is computed for: the wrapper minus the scrollbar gutter. Side panels
   * float over the timeline and don't change it. */
  viewportW: number;
  /** Visible width of the scroller right now. */
  clientW: number;
  /** Full viewer height (h-dvh, fullscreen-aware). */
  viewportH: number;
  /** Height of the band between track and comments (minimap and controls rows), without the
   * fold passed in – its caller adds that itself, in the same frame it animates it. */
  controlsH: number;
}

const same = (a: TimelineMetrics | null, b: TimelineMetrics) =>
  a !== null &&
  a.viewportW === b.viewportW &&
  a.clientW === b.clientW &&
  a.viewportH === b.viewportH &&
  a.controlsH === b.controlsH;

/**
 * Measures what the timeline geometry depends on – before the first paint, then whenever the
 * root, the scroller or the controls row resize. A fold inside the controls row (`foldRef`) is
 * left out of `controlsH`: while it animates, the band resizes every frame, but the metrics stay.
 */
export function useTimelineMetrics(
  wrapperRef: RefObject<HTMLElement | null>,
  scrollerRef: RefObject<HTMLElement | null>,
  controlsRef: RefObject<HTMLElement | null>,
  foldRef?: RefObject<HTMLElement | null>,
): TimelineMetrics | null {
  const [metrics, setMetrics] = useState<TimelineMetrics | null>(null);

  useLayoutEffect(() => {
    // The viewer root (the wrapper's parent): its ref would only attach after this effect.
    const root = wrapperRef.current?.parentElement;
    const scroller = scrollerRef.current;
    const controls = controlsRef.current;
    if (!root || !scroller || !controls) return;
    const measure = () => {
      const gutter = scroller.offsetWidth - scroller.clientWidth;
      const style = getComputedStyle(root);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const next: TimelineMetrics = {
        viewportW: Math.round(root.clientWidth - padding - gutter),
        clientW: scroller.clientWidth,
        viewportH: root.clientHeight,
        controlsH: Math.round(
          controls.getBoundingClientRect().height -
            (foldRef?.current?.getBoundingClientRect().height ?? 0),
        ),
      };
      setMetrics((current) => (same(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(scroller);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [wrapperRef, scrollerRef, controlsRef, foldRef]);

  return metrics;
}
