import { useEffect, useRef } from 'react';
import { useEditing } from '../../editing/editing-context';
import { useZoomToRect } from '../../stage/hooks/useZoomToRect';
import { NO_COVER, panBy } from '../../stage/lib/slide-zoom';
import { coverIn } from '../../timeline/hooks/useTimelineWheel';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { anchorRect } from '../lib/comment-selectors';

/** Room (px) kept between a mark moved into view and its frame's edges. */
const REVEAL_INSET_PX = 24;

/**
 * Opening a thread whose mark is a small box (or drawing) zooms its slide in on it; one outside
 * the part a zoomed slide shows is moved into view. Closing it, or opening one elsewhere, zooms
 * back. Whole-slide comments have nothing to zoom to. Off in the settings („An Kommentare
 * heranzoomen“).
 * In the layers view the mark is on its plane, elsewhere in 3D than on the flat slide: there it is
 * only moved into view, as measured on screen, and stays there.
 */
export function useThreadZoom() {
  const { threadById, slides, slideIndex } = useViewerData();
  const { focusedThreadId, threadPanelOpen } = useViewerState();
  const { layers } = useEditing();
  const thread = threadPanelOpen && focusedThreadId ? threadById.get(focusedThreadId) : undefined;
  // Between two slides (`slideId` null): no slide to zoom.
  const index = thread?.root.slideId ? slideIndex.get(thread.root.slideId) : undefined;
  const slide = index === undefined ? undefined : slides[index];
  const rect = thread && slide ? anchorRect(thread.root, slide.shapes) : null;
  useZoomToRect(
    thread && slide && rect && !layers ? { key: thread.id, slideId: slide.id, rect } : null,
    'commentZoom',
  );
  useRevealLayerMark(
    thread && slide && layers ? thread.id : null,
    thread && slide && layers ? slide.id : null,
  );
}

/** Screen pixels to move a span `from`–`to` by so it shows in `start`–`end` (0: it does). */
function shiftInto(from: number, to: number, start: number, end: number) {
  const inset = Math.min(REVEAL_INSET_PX, (end - start) / 4);
  if (to - from > end - start - 2 * inset) {
    // Larger than the view: fine while it fills it, else centred.
    return from <= start && to >= end ? 0 : (start + end) / 2 - (from + to) / 2;
  }
  if (from < start + inset) return start + inset - from;
  if (to > end - inset) return end - inset - to;
  return 0;
}

/**
 * In the layers view: a thread's marks outside what its zoomed slide shows are moved into view, at
 * the same zoom – measured once the opened panel has settled the layout.
 */
function useRevealLayerMark(threadId: string | null, slideId: string | null) {
  const { slideZooms } = useViewerState();
  const dispatch = useViewerDispatch();
  const zooms = useRef(slideZooms);
  useEffect(() => {
    zooms.current = slideZooms;
  });

  useEffect(() => {
    if (!threadId || !slideId) return;
    const reveal = () => {
      // Unzoomed, the stack shows whole.
      const zoom = zooms.current.get(slideId);
      if (!zoom || zoom.scale <= 1) return;
      const frame = document.querySelector<HTMLElement>(
        `[data-slide-frame="${CSS.escape(slideId)}"]`,
      );
      const marks = frame?.querySelectorAll(
        `[data-layer-marks] [data-hover-thread="${CSS.escape(threadId)}"] [data-mark]`,
      );
      if (!frame || !marks?.length) return;
      const boxes = [...marks].map((mark) => mark.getBoundingClientRect());
      const view = frame.getBoundingClientRect();
      const dx = shiftInto(
        Math.min(...boxes.map((box) => box.left)),
        Math.max(...boxes.map((box) => box.right)),
        view.left,
        view.right,
      );
      const dy = shiftInto(
        Math.min(...boxes.map((box) => box.top)),
        Math.max(...boxes.map((box) => box.bottom)),
        view.top,
        view.bottom,
      );
      if (!dx && !dy) return;
      // As a hand moving the stack by that much (`useHandPan`).
      const moved = panBy(zoom, -dx / view.width, -dy / view.height, coverIn(frame) ?? NO_COVER);
      dispatch({ type: 'slideZoomChanged', slideId, zoom: { slideId, ...moved } });
    };
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(reveal);
    });
    return () => cancelAnimationFrame(frame);
  }, [threadId, slideId, dispatch]);
}
