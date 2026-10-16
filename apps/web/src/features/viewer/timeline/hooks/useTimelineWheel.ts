import { useEffect, useEffectEvent, type RefObject } from 'react';
import { rafThrottle } from '@/lib/dom';
import type { TrackGeometry } from '../lib/timeline-layout';
import { pinchSplit, wheelSplit } from '../lib/split';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import type { SizeAnchor } from '../timeline-context';

/** Safari's non-standard pinch event (trackpad and touch). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
}

/**
 * Wheel and pinch on the timeline (BER-96):
 * - Pinch and Ctrl/⌘ + wheel move the split handle – bigger or smaller slides, like zooming a
 *   video timeline – anchored horizontally at the pointer. Chrome, Firefox and Edge report
 *   trackpad pinch as a wheel event with `ctrlKey`; Safari sends `gesture*` events.
 * - Over the track and the controls a plain vertical wheel scrolls the timeline sideways, like the
 *   slides, as long as it can still move that way.
 * - Over the comments the browser scrolls natively: up/down scrolls up and down, sideways scrolls
 *   sideways.
 */
export function useTimelineWheel({
  scrollerRef,
  geometry,
  anchorRef,
  enabled,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  geometry: TrackGeometry | null;
  anchorRef: RefObject<SizeAnchor | null>;
  /** Off on phones: slides always fill the width there (no split handle). */
  enabled: boolean;
}) {
  const { split } = useViewerState();
  const dispatch = useViewerDispatch();
  const current = useEffectEvent(() => ({ split, geometry }));

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    // Several wheel events can arrive per frame – they compound, then dispatch once.
    let pending: number | null = null;
    const flush = rafThrottle(() => {
      if (pending === null) return;
      // Nothing changes (already at an end): drop the anchor so it can't leak into a later change.
      if (pending === current().split) anchorRef.current = null;
      else dispatch({ type: 'splitChanged', split: pending });
      pending = null;
    });
    const anchorAt = (clientX: number) => {
      const viewportX = clientX - scroller.getBoundingClientRect().left;
      anchorRef.current = { contentX: scroller.scrollLeft + viewportX, viewportX };
    };

    const onWheel = (event: WheelEvent) => {
      // Already taken (the minimap scrolls its own overflowing row).
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey) {
        // Otherwise the browser zooms the whole page.
        event.preventDefault();
        const { split: base, geometry: geo } = current();
        if (!geo) return;
        anchorAt(event.clientX);
        pending = wheelSplit(pending ?? base, event.deltaY, event.deltaMode, geo);
        flush.schedule();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Comments (and text fields) scroll natively.
      if (!target?.closest('[data-timeline-header]')) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      const max = scroller.scrollWidth - scroller.clientWidth;
      if ((delta > 0 && scroller.scrollLeft >= max - 1) || (delta < 0 && scroller.scrollLeft <= 1))
        return;
      event.preventDefault();
      scroller.scrollBy({ left: delta });
    };

    let gestureStart: number | null = null;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = current().split;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const geo = current().geometry;
      if (!geo) return;
      const gesture = event as GestureEvent;
      anchorAt(gesture.clientX);
      pending = pinchSplit(gestureStart, gesture.scale, geo);
      flush.schedule();
    };
    const preventDefault = (event: Event) => event.preventDefault();

    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('gesturestart', onGestureStart);
    scroller.addEventListener('gesturechange', onGestureChange);
    scroller.addEventListener('gestureend', preventDefault);
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('gesturestart', onGestureStart);
      scroller.removeEventListener('gesturechange', onGestureChange);
      scroller.removeEventListener('gestureend', preventDefault);
      flush.cancel();
    };
  }, [scrollerRef, anchorRef, enabled, dispatch]);
}
