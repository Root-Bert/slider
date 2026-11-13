import { useEffect, useEffectEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { rafThrottle } from '@/lib/dom';
import { wheelPixels } from '@/lib/wheel';
import type { TrackGeometry } from '../lib/timeline-layout';
import { pinchSplit, wheelFactor, wheelSplit } from '../lib/split';
import { normalizeClientPoint } from '../../lib/geometry';
import {
  NO_COVER,
  panBy,
  SLIDE_ZOOM_MIN,
  snappedCentre,
  startView,
  zoomAround,
  type Cover,
  type SlideZoom,
} from '../../stage/lib/slide-zoom';

type View = Pick<SlideZoom, 'scale' | 'x' | 'y'>;
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { useViewerStore } from '../../state/viewer-store';
import type { SizeAnchor } from '../timeline-context';
import { isModKey } from '@/lib/keyboard';

/** Safari's non-standard pinch event (trackpad and touch). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** The slide frame under an event's target – where a zoom over a slide goes. */
export const frameOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>('[data-slide-frame]') : null;

/** How much a frame's slide overflows it (`SlideFrame`): set while it is cropped unzoomed. */
export const coverIn = (frame: HTMLElement): Cover | null => {
  const [x, y] = frame.dataset.slideCover?.split(',').map(Number) ?? [];
  return x && y ? { x, y } : null;
};

/** A text field under the pointer that can still scroll the way the wheel goes. */
const scrollsItself = (target: Element, deltaY: number) => {
  const field = target.closest('textarea');
  if (!field || field.scrollHeight <= field.clientHeight) return false;
  return deltaY < 0
    ? field.scrollTop > 0
    : field.scrollTop + field.clientHeight < field.scrollHeight;
};

/** Where the pointer is on a slide frame, 0–1 each way. */
const focusIn = (frame: HTMLElement, clientX: number, clientY: number) =>
  normalizeClientPoint(clientX, clientY, frame.getBoundingClientRect());

/**
 * Wheel and pinch on the timeline (BER-96):
 * - Pinch and Ctrl/⌘ + wheel over a slide zoom into that slide (`stage/lib/slide-zoom`): it keeps
 *   its size and shows a part of itself, around the pointer. Zooming out ends at 1× – the rest of
 *   the interface never moves. Chrome, Firefox and Edge report trackpad pinch as a wheel event
 *   with `ctrlKey`; Safari sends `gesture*` events.
 * - Elsewhere on the timeline they move the split handle – bigger or smaller slides, like zooming
 *   a video timeline – anchored horizontally at the pointer.
 * - A plain wheel over the zoomed slide moves the part it shows, both ways. A slide cropped by
 *   its frame (portrait pages in the 16:9 view) moves up and down the same way until it reaches
 *   its edge.
 * - Up and down over the band of slides swipes its tracks (`onTrackWheel`: variants over the
 *   slides, notes under them).
 * - Everything else scrolls natively: up/down never moves the timeline sideways – a sideways
 *   swipe (or Shift + wheel) does.
 */
export function useTimelineWheel({
  scrollerRef,
  geometry,
  anchorRef,
  enabled,
  onTrackWheel,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  geometry: TrackGeometry | null;
  anchorRef: RefObject<SizeAnchor | null>;
  /** Off on phones: slides always fill the width there (no split handle). */
  enabled: boolean;
  /**
   * Up and down over the band of slides: swipes its tracks (`useTrackSwipe`) – `true` when it took
   * the wheel.
   */
  onTrackWheel?: (event: WheelEvent) => boolean;
}) {
  const { split } = useViewerState();
  const store = useViewerStore();
  const dispatch = useViewerDispatch();
  const current = useEffectEvent(() => ({
    split,
    geometry,
    slideZooms: store.getState().slideZooms,
  }));
  const trackWheel = useEffectEvent((event: WheelEvent) => onTrackWheel?.(event) ?? false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    // Several wheel events can arrive per frame – they compound, then dispatch once.
    let pending: number | null = null;
    // Zoom changes waiting, by slide; `null`: that slide's zoom ends.
    const pendingZooms = new Map<string, SlideZoom | null>();
    // Drawn in the frame it is dispatched in (`flushSync`) – left to React's scheduler, it would
    // show a frame later.
    const flush = rafThrottle(() =>
      flushSync(() => {
        for (const [slideId, zoom] of pendingZooms) {
          dispatch({ type: 'slideZoomChanged', slideId, zoom });
        }
        pendingZooms.clear();
        if (pending === null) return;
        // Nothing changes (already at an end): drop the anchor so it can't leak into a later change.
        if (pending === current().split) anchorRef.current = null;
        else dispatch({ type: 'splitChanged', split: pending });
        pending = null;
      }),
    );
    const anchorAt = (clientX: number) => {
      const viewportX = clientX - scroller.getBoundingClientRect().left;
      anchorRef.current = { contentX: scroller.scrollLeft + viewportX, viewportX };
    };
    /** The zoom of the slide in `frame`, counting a change not dispatched yet. */
    const zoomIn = (frame: HTMLElement) => {
      const id = frame.dataset.slideFrame!;
      return pendingZooms.has(id) ? pendingZooms.get(id)! : (current().slideZooms.get(id) ?? null);
    };
    /** Zooms the slide in `frame` by `factor` around the pointer; furthest out, zooming out does nothing. */
    const zoomSlide = (frame: HTMLElement, factor: number, clientX: number, clientY: number) => {
      const zoom = zoomIn(frame);
      if ((zoom?.scale ?? 1) <= SLIDE_ZOOM_MIN && factor <= 1) return;
      const cover = coverIn(frame) ?? NO_COVER;
      const view = zoomAround(zoom, factor, focusIn(frame, clientX, clientY), cover);
      const slideId = frame.dataset.slideFrame!;
      pendingZooms.set(slideId, view && { slideId, ...view });
      flush.schedule();
    };

    // Per slide, a pan by the wheel as shown and as it went before the middle caught it.
    const wheeled = new Map<string, { shown: View; free: View }>();
    const sameView = (a: View, b: View) => a.scale === b.scale && a.x === b.x && a.y === b.y;
    const onWheel = (event: WheelEvent) => {
      // Already taken (the minimap scrolls its own overflowing row).
      if (event.defaultPrevented) return;
      if (isModKey(event)) {
        // Otherwise the browser zooms the whole page.
        event.preventDefault();
        const frame = frameOf(event.target);
        const factor = wheelFactor(event.deltaY, event.deltaMode);
        if (frame) {
          zoomSlide(frame, factor, event.clientX, event.clientY);
          return;
        }
        const { split: base, geometry: geo } = current();
        if (!geo) return;
        anchorAt(event.clientX);
        pending = wheelSplit(pending ?? base, event.deltaY, event.deltaMode, geo);
        flush.schedule();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // A panel over the slides that scrolls itself (the prompt on Folie 1): the browser scrolls it.
      if (target?.closest('[data-own-wheel]')) return;
      const frame = frameOf(target);
      const zoom = frame && zoomIn(frame);
      const cover = frame && coverIn(frame);
      const zoomed = zoom !== null && zoom.scale !== 1;
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
        const slideId = frame.dataset.slideFrame!;
        // Caught in the middle (zoomed out), it moves on from where the wheel would have taken it
        // – else it could not be scrolled out of the catch in small steps.
        const caught = wheeled.get(slideId);
        const base = caught && sameView(caught.shown, from) ? caught.free : from;
        const free = panBy(base, dx / box.width, dy / box.height, cover ?? NO_COVER);
        const view = snappedCentre(free, box.width, box.height, cover ?? NO_COVER);
        wheeled.set(slideId, { shown: view, free });
        // Only cropped, at its edge: the wheel does what it does elsewhere.
        const moved = view.x !== from.x || view.y !== from.y;
        if (zoomed || moved) {
          event.preventDefault();
          if (moved) {
            pendingZooms.set(slideId, { slideId, ...view });
            flush.schedule();
          }
          return;
        }
      }
      // Up and down over the band: its tracks (variants over the slides, notes under them) – not
      // while a notes field still scrolls that way itself.
      if (
        vertical &&
        target?.closest('[data-track], [data-track-dots]') &&
        !scrollsItself(target, event.deltaY)
      )
        trackWheel(event);
    };

    let gestureStart: number | null = null;
    // A pinch over a slide zooms it: the slide's frame and its zoom when the pinch began.
    let gestureFrame: HTMLElement | null = null;
    let gestureZoom: SlideZoom | null = null;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = current().split;
      gestureFrame = frameOf(event.target);
      gestureZoom = gestureFrame && zoomIn(gestureFrame);
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const geo = current().geometry;
      if (!geo) return;
      const gesture = event as GestureEvent;
      if (gestureFrame) {
        const focus = focusIn(gestureFrame, gesture.clientX, gesture.clientY);
        const cover = coverIn(gestureFrame) ?? NO_COVER;
        const view = zoomAround(gestureZoom, gesture.scale, focus, cover);
        const slideId = gestureFrame.dataset.slideFrame!;
        pendingZooms.set(slideId, view && { slideId, ...view });
        flush.schedule();
        return;
      }
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
