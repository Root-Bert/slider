import { useEffect, useEffectEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { isTypingTarget, rafThrottle } from '@/lib/dom';
import { OWN_SPACE } from '../../lib/space-taps';
import { NO_COVER, panBy, snappedCentre, type SlideZoom } from '../../stage/lib/slide-zoom';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerStore } from '../../state/viewer-store';
import { coverIn, frameOf } from './useTimelineWheel';

/**
 * Moving the view by hand, as in Figma or Miro: Space held and dragging, or dragging with the
 * middle mouse button. Over a slide zoomed in or out (`slideZooms`) it moves the part shown – on the
 * flat slide and taken apart in 3D alike; anywhere else it scrolls the timeline. A plain drag stays
 * reviewing or editing; the press never reaches them (taken in the capture phase).
 */
export function useHandPan({
  scrollerRef,
  enabled,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const store = useViewerStore();
  const dispatch = useViewerDispatch();
  const zoomOf = useEffectEvent(
    (slideId: string) => store.getState().slideZooms.get(slideId) ?? null,
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    // Space held: the pointer is a hand over the timeline.
    let held = false;
    const hand = (on: boolean) => {
      held = on;
      if (on) scroller.dataset.handPan = '';
      else delete scroller.dataset.handPan;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest(OWN_SPACE)) return;
      // Not a page scroll: Space is the hand here.
      event.preventDefault();
      if (!held) hand(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') hand(false);
    };
    const onBlur = () => hand(false);

    // Windows starts its autoscroll on a middle press.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'mouse') return;
      if (down.button !== 1 && !(held && down.button === 0)) return;
      down.preventDefault();
      down.stopPropagation();
      const frame = frameOf(down.target);
      const slideId = frame?.dataset.slideFrame;
      const zoom = slideId ? zoomOf(slideId) : null;
      // Zoomed in or out: the slide moves in its frame.
      const zoomed = frame && slideId && zoom && zoom.scale !== 1 ? { frame, slideId, zoom } : null;
      const box = zoomed?.frame.getBoundingClientRect();
      const cover = (zoomed && coverIn(zoomed.frame)) ?? NO_COVER;
      const startLeft = scroller.scrollLeft;
      const startTop = scroller.scrollTop;
      let next: SlideZoom | null = null;
      const flush = rafThrottle(() => {
        // Drawn this frame, not after it (`flushSync`): the slide stays under the hand.
        const view = next;
        if (view)
          flushSync(() =>
            dispatch({ type: 'slideZoomChanged', slideId: view.slideId, zoom: view }),
          );
      });
      scroller.setPointerCapture(down.pointerId);
      scroller.dataset.handPanning = '';
      window.getSelection()?.removeAllRanges();

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - down.clientX;
        const dy = move.clientY - down.clientY;
        if (zoomed && box && box.width > 0 && box.height > 0) {
          // The slide follows the hand: the part shown moves the other way – zoomed out, caught
          // in the middle of its frame on the way.
          const view = snappedCentre(
            panBy(zoomed.zoom, -dx / box.width, -dy / box.height, cover),
            box.width,
            box.height,
            cover,
          );
          next = { slideId: zoomed.slideId, ...view };
          flush.schedule();
          return;
        }
        scroller.scrollLeft = startLeft - dx;
        scroller.scrollTop = startTop - dy;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        delete scroller.dataset.handPanning;
        // The click that ends it is no click on the slide.
        const swallow = (click: MouseEvent) => click.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.addEventListener('auxclick', swallow, { capture: true, once: true });
        setTimeout(() => {
          window.removeEventListener('click', swallow, { capture: true });
          window.removeEventListener('auxclick', swallow, { capture: true });
        });
      };
      // Capturing: the stage and the edit layer under it never see the hand's moves.
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    scroller.addEventListener('mousedown', onMouseDown, { capture: true });
    scroller.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      hand(false);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      scroller.removeEventListener('mousedown', onMouseDown, { capture: true });
      scroller.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [scrollerRef, enabled, dispatch]);
}
