import { useEffect, useEffectEvent } from 'react';
import { isTypingTarget } from '../lib/dom';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Global keyboard shortcuts of the viewer:
 * ←/→ previous/next slide, Home/End first/last, F fullscreen,
 * ⌘Z / ⇧⌘Z undo/redo while drawing, Esc cancels the draft → drops the tool → closes the thread.
 */
export function useViewerShortcuts({ onToggleFullscreen }: { onToggleFullscreen: () => void }) {
  const { slides, slideIndex } = useViewerData();
  const { activeSlideId, draft, tool, threadPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();

  const goTo = (index: number) => {
    const slide = slides[Math.max(0, Math.min(slides.length - 1, index))];
    if (slide) registry.scrollToSlide(slide.id);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Modal dialogs (share, delete confirmation) handle their own keys.
    if (
      event.defaultPrevented ||
      (event.target instanceof Element && event.target.closest('dialog'))
    )
      return;

    if (event.key === 'Escape') {
      // Typing in the composer: Esc still cancels the draft, that's what people expect.
      if (draft) dispatch({ type: 'draftCancelled' });
      else if (tool) dispatch({ type: 'toolSelected', tool: null });
      else if (threadPanelOpen) dispatch({ type: 'threadPanelClosed' });
      else return;
      event.preventDefault();
      return;
    }

    if (isTypingTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key.toLowerCase() === 'z' && draft) {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (mod || event.altKey) return;

    const current = activeSlideId ? (slideIndex.get(activeSlideId) ?? 0) : 0;
    switch (event.key) {
      case 'ArrowLeft':
        goTo(current - 1);
        break;
      case 'ArrowRight':
        goTo(current + 1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(slides.length - 1);
        break;
      case 'f':
      case 'F':
        onToggleFullscreen();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
