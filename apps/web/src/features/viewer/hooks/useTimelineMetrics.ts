import { useLayoutEffect, useState, type RefObject } from 'react';

export interface TimelineMetrics {
  /** Width the geometry is computed for: the wrapper minus the scrollbar gutter. Opening the
   * thread panel doesn't change it (the panel pads the root, not the wrapper's parent width). */
  viewportW: number;
  /** Visible width of the scroller right now (shrinks while the thread panel is open). */
  clientW: number;
  /** Full viewer height (h-dvh, fullscreen-aware). */
  viewportH: number;
  /** Height of the minimap and controls rows between track and comments. */
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
 * root, the scroller or the controls row resize.
 */
export function useTimelineMetrics(
  wrapperRef: RefObject<HTMLElement | null>,
  scrollerRef: RefObject<HTMLElement | null>,
  controlsRef: RefObject<HTMLElement | null>,
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
      // The thread panel pads the root; the geometry ignores it so the track keeps its height.
      const panelPad = parseFloat(style.paddingRight) || 0;
      const next: TimelineMetrics = {
        viewportW: Math.round(root.clientWidth - padding + panelPad - gutter),
        clientW: scroller.clientWidth,
        viewportH: root.clientHeight,
        controlsH: Math.round(controls.getBoundingClientRect().height),
      };
      setMetrics((current) => (same(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(scroller);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [wrapperRef, scrollerRef, controlsRef]);

  return metrics;
}
