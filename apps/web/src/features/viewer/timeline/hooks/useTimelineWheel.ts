import { useEffect, useEffectEvent, type RefObject } from 'react';
import { rafThrottle } from '@/lib/dom';
import { wheelPixels } from '@/lib/wheel';
import { resolvedSplit, type TrackGeometry } from '../lib/timeline-layout';
import { pinchSplit, SPLIT_MAX, wheelFactor, wheelSplit } from '../lib/split';
import { normalizeClientPoint } from '../../lib/geometry';
import {
  NO_COVER,
  panBy,
  startView,
  zoomAround,
  type Cover,
  type SlideZoom,
} from '../../stage/lib/slide-zoom';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import type { SizeAnchor } from '../timeline-context';
import { isModKey } from '@/lib/keyboard';

/** Safari's non-standard pinch event (trackpad and touch). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** The slide frame under an event's target – where a zoom past the largest slides goes. */
const frameOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>('[data-slide-frame]') : null;

/** How much a frame's slide overflows it (`SlideFrame`): set while it is cropped unzoomed. */
const coverIn = (frame: HTMLElement): Cover | null => {
  const [x, y] = frame.dataset.slideCover?.split(',').map(Number) ?? [];
  return x && y ? { x, y } : null;
};

/** Where the pointer is on a slide frame, 0–1 each way. */
const focusIn = (frame: HTMLElement, clientX: number, clientY: number) =>
  normalizeClientPoint(clientX, clientY, frame.getBoundingClientRect());

/**
 * Wheel and pinch on the timeline (BER-96):
 * - Pinch and Ctrl/⌘ + wheel move the split handle – bigger or smaller slides, like zooming a
 *   video timeline – anchored horizontally at the pointer. Chrome, Firefox and Edge report
 *   trackpad pinch as a wheel event with `ctrlKey`; Safari sends `gesture*` events.
 * - Zooming in further once the slides are as big as they get zooms into the slide under the
 *   pointer (`stage/lib/slide-zoom`): the slide keeps its size and shows a part of itself. Zooming
 *   out first undoes that, then shrinks the slides again.
 * - A plain wheel over the zoomed slide moves the part it shows, both ways. A slide cropped by
 *   its frame (portrait pages in the 16:9 view) moves up and down the same way until it reaches
 *   its edge.
 * - Everything else scrolls natively: up/down never moves the timeline sideways – a sideways
 *   swipe (or Shift + wheel) does.
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
  const { split, slideZooms } = useViewerState();
  const dispatch = useViewerDispatch();
  const current = useEffectEvent(() => ({ split, geometry, slideZooms }));

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    // Several wheel events can arrive per frame – they compound, then dispatch once.
    let pending: number | null = null;
    // Zoom changes waiting, by slide; `null`: that slide's zoom ends.
    const pendingZooms = new Map<string, SlideZoom | null>();
    const flush = rafThrottle(() => {
      for (const [slideId, zoom] of pendingZooms) {
        dispatch({ type: 'slideZoomChanged', slideId, zoom });
      }
      pendingZooms.clear();
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
    /** The zoom of the slide in `frame`, counting a change not dispatched yet. */
    const zoomIn = (frame: HTMLElement) => {
      const id = frame.dataset.slideFrame!;
      return pendingZooms.has(id) ? pendingZooms.get(id)! : (current().slideZooms.get(id) ?? null);
    };
    const atLargest = () => {
      const { split: base, geometry: geo } = current();
      return geo !== null && resolvedSplit(pending ?? base, geo) >= SPLIT_MAX;
    };
    /** Zooms the slide in `frame` by `factor` – unless it isn't zoomed and that would be no zoom-in past the largest slides. */
    const zoomSlide = (frame: HTMLElement, factor: number, clientX: number, clientY: number) => {
      const zoom = zoomIn(frame);
      // At 1× (a cropped slide keeps its view there) zooming out shrinks the slides again.
      if ((!zoom || zoom.scale <= 1) && (factor <= 1 || !atLargest())) return false;
      const cover = coverIn(frame) ?? NO_COVER;
      const view = zoomAround(zoom, factor, focusIn(frame, clientX, clientY), cover);
      const slideId = frame.dataset.slideFrame!;
      pendingZooms.set(slideId, view && { slideId, ...view });
      flush.schedule();
      return true;
    };

    const onWheel = (event: WheelEvent) => {
      // Already taken (the minimap scrolls its own overflowing row).
      if (event.defaultPrevented) return;
      if (isModKey(event)) {
        // Otherwise the browser zooms the whole page.
        event.preventDefault();
        const frame = frameOf(event.target);
        const factor = wheelFactor(event.deltaY, event.deltaMode);
        if (frame && zoomSlide(frame, factor, event.clientX, event.clientY)) return;
        const { split: base, geometry: geo } = current();
        if (!geo) return;
        anchorAt(event.clientX);
        pending = wheelSplit(pending ?? base, event.deltaY, event.deltaMode, geo);
        flush.schedule();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const frame = frameOf(target);
      const zoom = frame && zoomIn(frame);
      const cover = frame && coverIn(frame);
      const zoomed = zoom !== null && zoom.scale > 1;
      // Cropped only, the slide moves up and down – a sideways swipe scrolls the timeline.
      const vertical = Math.abs(event.deltaY) > Math.abs(event.deltaX) && !event.shiftKey;
      if (frame && (zoomed || (cover && vertical))) {
        const box = frame.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        // A mouse wheel only scrolls up and down; Shift turns it sideways, like a page.
        const sideways = event.shiftKey && event.deltaX === 0;
        const dx = zoomed
          ? wheelPixels(sideways ? event.deltaY : event.deltaX, event.deltaMode)
          : 0;
        const dy = sideways ? 0 : wheelPixels(event.deltaY, event.deltaMode);
        const from = zoom ?? startView(cover!);
        const view = panBy(from, dx / box.width, dy / box.height, cover ?? NO_COVER);
        // Only cropped, at its edge: the wheel does what it does elsewhere.
        const moved = view.x !== from.x || view.y !== from.y;
        if (zoomed || moved) {
          event.preventDefault();
          if (moved) {
            const slideId = frame.dataset.slideFrame!;
            pendingZooms.set(slideId, { slideId, ...view });
            flush.schedule();
          }
          return;
        }
      }
    };

    let gestureStart: number | null = null;
    // A pinch over a slide that zooms it: the slide's frame, its zoom when that began and the
    // gesture's scale then (a pinch can grow the slides to their largest, then zoom on).
    let gestureFrame: HTMLElement | null = null;
    let gestureZoom: { from: SlideZoom | null; scale: number } | null = null;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = current().split;
      gestureFrame = frameOf(event.target);
      const zoom = gestureFrame && zoomIn(gestureFrame);
      // A cropped slide's view at 1× is no zoom: pinching resizes the slides first.
      gestureZoom = zoom && zoom.scale > 1 ? { from: zoom, scale: 1 } : null;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const geo = current().geometry;
      if (!geo) return;
      const gesture = event as GestureEvent;
      if (gestureFrame && gestureZoom) {
        const focus = focusIn(gestureFrame, gesture.clientX, gesture.clientY);
        const cover = coverIn(gestureFrame) ?? NO_COVER;
        const view = zoomAround(gestureZoom.from, gesture.scale / gestureZoom.scale, focus, cover);
        const slideId = gestureFrame.dataset.slideFrame!;
        pendingZooms.set(slideId, view && { slideId, ...view });
        flush.schedule();
        return;
      }
      anchorAt(gesture.clientX);
      pending = pinchSplit(gestureStart, gesture.scale, geo);
      if (gestureFrame && gesture.scale > 1 && pending >= SPLIT_MAX) {
        gestureZoom = { from: zoomIn(gestureFrame), scale: gesture.scale };
      }
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
