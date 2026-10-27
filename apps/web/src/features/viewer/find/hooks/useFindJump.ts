import { useRef } from 'react';
import { useStageRegistry } from '../../state/stage-registry';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import type { FindHit } from '../lib/find-hits';

/**
 * Shows a hit of the in-review search (BER-176), with what the viewer already does: a slide hit
 * makes its slide active, brings it into view (like ←/→) and outlines the box the text is in; a
 * comment hit opens its thread in the panel, as a click on its pin or card does – which also
 * brings its slide into view. `null` clears the outline. A thread panel the search opened closes
 * again on the next slide hit; one opened by hand stays.
 */
export function useFindJump() {
  const { threadPanelOpen, focusedThreadId } = useViewerState();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const openedThreadId = useRef<string | null>(null);

  return (hit: FindHit | null) => {
    if (hit?.kind !== 'slide') registry.setFindHighlight(null);
    if (!hit) return;
    if (hit.kind === 'slide') {
      registry.setFindHighlight(hit.shape ? { slideId: hit.slideId, rect: hit.shape.bbox } : null);
      if (threadPanelOpen && focusedThreadId === openedThreadId.current) {
        dispatch({ type: 'threadPanelClosed' });
      }
      openedThreadId.current = null;
      dispatch({ type: 'activeSlideChanged', slideId: hit.slideId });
      registry.revealSlide(hit.slideId, { align: 'nearest', behavior: 'smooth' });
      return;
    }
    if (threadPanelOpen && focusedThreadId === hit.threadId) return;
    openedThreadId.current = hit.threadId;
    dispatch({ type: 'threadFocused', threadId: hit.threadId, openPanel: true });
  };
}
