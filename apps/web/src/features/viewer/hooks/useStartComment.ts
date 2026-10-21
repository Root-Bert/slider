import { useCallback } from 'react';
import { focusCommentField } from '../comments/lib/composer-focus';
import { boxAnchor } from '../stage/lib/box-anchor';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { isBoxModeActive, useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Starts a comment from the keyboard (C) or the context menu's "Kommentar zur Folie": on the
 * active slide as a whole – or, with `onHoveredBox` (the C key) in box mode, on the PowerPoint box outlined under
 * the pointer, the same anchor a click on it places. The focus goes into the composer.
 */
export function useStartComment(): (options?: { onHoveredBox?: boolean }) => void {
  const { slides, canComment } = useViewerData();
  const state = useViewerState();
  const { activeSlideId } = state;
  const boxes = isBoxModeActive(state);
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();

  return useCallback(
    ({ onHoveredBox = false } = {}) => {
      if (!canComment) return;
      const hovered = onHoveredBox && boxes ? registry.getHoveredBox() : null;
      const slideId = hovered?.slideId ?? activeSlideId ?? slides[0]?.id;
      if (!slideId) return;
      dispatch({ type: 'activeSlideChanged', slideId });
      dispatch({
        type: 'anchorPlaced',
        slideId,
        anchor: hovered ? boxAnchor(hovered.shape) : { type: 'slide' },
      });
      // After the composer has rendered (or moved to the new anchor).
      requestAnimationFrame(() => focusCommentField());
    },
    [activeSlideId, boxes, canComment, dispatch, registry, slides],
  );
}
