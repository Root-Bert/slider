import { useEffect, useEffectEvent, type RefObject } from 'react';
import { rafThrottle } from '../lib/dom';
import { clampZoom, wheelZoom } from '../lib/zoom';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** A pinch or ⌘ + wheel counts as one gesture until the events pause for this long. */
const GESTURE_IDLE_MS = 250;

/**
 * Keeps `area` at its current height while a zoom gesture runs, so zooming out doesn't move the
 * controls below it away from the pointer. Released by `releaseHeight` when the gesture ends.
 */
export function lockHeight(area: HTMLElement) {
  if (!area.style.minHeight) area.style.minHeight = `${area.offsetHeight}px`;
}

export function releaseHeight(area: HTMLElement) {
  area.style.minHeight = '';
}

/** Safari's non-standard pinch event (trackpad and touch). */
interface GestureEvent extends UIEvent {
  scale: number;
}

/**
 * Pinch and Ctrl/⌘ + wheel over the slide area zoom the slide row (BER-96) instead of the page.
 * Chrome, Firefox and Edge report trackpad pinch as a wheel event with `ctrlKey`; Safari sends
 * `gesture*` events. A plain wheel keeps scrolling the page, a horizontal one the stage.
 */
export function useStageZoom(targetRef: RefObject<HTMLElement | null>) {
  const { zoom } = useViewerState();
  const dispatch = useViewerDispatch();
  const currentZoom = useEffectEvent(() => zoom);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    // Several wheel events can arrive per frame – they compound, then dispatch once.
    let pending: number | null = null;
    const flush = rafThrottle(() => {
      if (pending !== null) dispatch({ type: 'zoomChanged', zoom: pending });
      pending = null;
    });

    let idleTimer = 0;
    let gestureActive = false;
    const markGesture = () => {
      if (!gestureActive) {
        // Lock the height right away – the first zoom step may render together with this.
        lockHeight(target);
        dispatch({ type: 'zoomGestureChanged', active: true });
      }
      gestureActive = true;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        gestureActive = false;
        dispatch({ type: 'zoomGestureChanged', active: false });
      }, GESTURE_IDLE_MS);
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Otherwise the browser zooms the whole page.
      event.preventDefault();
      markGesture();
      pending = wheelZoom(pending ?? currentZoom(), event.deltaY, event.deltaMode);
      flush.schedule();
    };

    let gestureStartZoom = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = currentZoom();
      markGesture();
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      markGesture();
      pending = clampZoom(gestureStartZoom * (event as GestureEvent).scale);
      flush.schedule();
    };
    const preventDefault = (event: Event) => event.preventDefault();

    target.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('gesturestart', onGestureStart);
    target.addEventListener('gesturechange', onGestureChange);
    target.addEventListener('gestureend', preventDefault);
    return () => {
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('gesturestart', onGestureStart);
      target.removeEventListener('gesturechange', onGestureChange);
      target.removeEventListener('gestureend', preventDefault);
      flush.cancel();
      window.clearTimeout(idleTimer);
      if (gestureActive) dispatch({ type: 'zoomGestureChanged', active: false });
    };
  }, [targetRef, dispatch]);
}
