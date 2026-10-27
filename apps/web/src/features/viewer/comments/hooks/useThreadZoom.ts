import { useZoomToRect } from '../../stage/hooks/useZoomToRect';
import { useViewerData } from '../../state/viewer-data';
import { useViewerState } from '../../state/viewer-state';
import { anchorRect } from '../lib/comment-selectors';

/**
 * Opening a thread whose mark is a small box (or drawing) zooms its slide in on it; closing it,
 * or opening one elsewhere, zooms back. Pins and whole-slide comments have nothing to zoom to.
 * Off in the settings („An Kommentare heranzoomen“).
 */
export function useThreadZoom() {
  const { threadById, slides, slideIndex } = useViewerData();
  const { focusedThreadId, threadPanelOpen } = useViewerState();
  const thread = threadPanelOpen && focusedThreadId ? threadById.get(focusedThreadId) : undefined;
  // Between two slides (`slideId` null): no slide to zoom.
  const index = thread?.root.slideId ? slideIndex.get(thread.root.slideId) : undefined;
  const slide = index === undefined ? undefined : slides[index];
  const rect = thread && slide ? anchorRect(thread.root, slide.shapes) : null;
  useZoomToRect(
    thread && slide && rect ? { key: thread.id, slideId: slide.id, rect } : null,
    'commentZoom',
  );
}
