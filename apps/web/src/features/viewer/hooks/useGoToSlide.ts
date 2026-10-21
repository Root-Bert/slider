import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';

/**
 * Makes the slide at `index` (0-based, clamped to the deck) active and scrolls it into view;
 * the URL follows via `useSlideUrlSync`.
 */
export function useGoToSlide() {
  const { slides } = useViewerData();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();

  return (index: number) => {
    const slide = slides[Math.max(0, Math.min(slides.length - 1, index))];
    if (!slide) return;
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    registry.revealSlide(slide.id, { align: 'nearest', behavior: 'smooth' });
  };
}
