import { useEffect, useEffectEvent } from 'react';
import { isTypingTarget, pointerUsed, watchPointer } from '@/lib/dom';
import { useGoToSlide } from './useGoToSlide';
import { useStartComment } from './useStartComment';
import { useViewerData } from '../state/viewer-data';
import { cycleTool, useViewerDispatch, useViewerState } from '../state/viewer-state';
import { isModKey } from '@/lib/keyboard';

/**
 * Global keyboard shortcuts of the viewer:
 * ←/→ previous/next slide, Home/End first/last, F fullscreen, P presentation, B PowerPoint boxes on/off,
 * G PowerPoint guides on/off, C comments on the active slide (in box mode on the box under the pointer), typing right after a drawing comments on it, Tab / ⇧Tab next/previous tool (while nothing is focused, once the pointer was used),
 * ⌘Z / ⇧⌘Z undo/redo while drawing, ⌘↵ sends the draft, Esc cancels the draft → drops the tool → closes the thread (or the deleted slides or the layers panel) → leaves the layers.
 */
export function useViewerShortcuts({
  onToggleFullscreen,
  onPresent,
}: {
  onToggleFullscreen: () => void;
  onPresent: () => void;
}) {
  const { slides, slideIndex, canComment } = useViewerData();
  const {
    activeSlideId,
    draft,
    tool,
    lastDrawing,
    threadPanelOpen,
    deletedPanelOpen,
    layersOpen,
    layersPanelOpen,
  } = useViewerState();
  const dispatch = useViewerDispatch();
  const goTo = useGoToSlide();
  const startComment = useStartComment();

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
      else if (deletedPanelOpen) dispatch({ type: 'deletedPanelSet', open: false });
      else if (layersPanelOpen) dispatch({ type: 'layersPanelSet', open: false });
      else if (layersOpen) dispatch({ type: 'layersSet', open: false });
      else return;
      event.preventDefault();
      return;
    }

    if (isTypingTarget(event.target)) return;
    const mod = isModKey(event);

    if (mod && event.key === 'Enter' && draft) {
      event.preventDefault();
      document.querySelector<HTMLFormElement>('form[data-composer]')?.requestSubmit();
      return;
    }
    if (mod && event.key.toLowerCase() === 'z' && draft) {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (mod || event.altKey) return;

    // Typing right after a freehand, arrow or marker drawing writes its comment (the letter
    // shortcuts wait until the tool is dropped).
    if (lastDrawing && !draft && event.key.length === 1 && event.key.trim() !== '') {
      event.preventDefault();
      dispatch({ type: 'drawingCommentStarted', ...lastDrawing, text: event.key });
      return;
    }

    // Tab / ⇧Tab steps through the tools while nothing has the focus (a click on the slide or the
    // tool bar keeps it off). Once a control has it, Tab moves it on as usual – keyboard users
    // must be able to reach every control (and leave it again). An open draft keeps it, too.
    // Before the pointer was used at all this session, Tab is plain focus order: keyboard-only visitors start
    // on the skip link ("Zu den Bedienelementen") instead of being caught in the tools.
    if (event.key === 'Tab') {
      const unfocused = event.target === document.body || event.target === document.documentElement;
      if (!canComment || draft || !unfocused || !pointerUsed()) return;
      event.preventDefault();
      // `toolSelected` toggles: picking the current tool again would drop it.
      const next = cycleTool(tool, event.shiftKey ? -1 : 1);
      dispatch({ type: 'toolSelected', tool: next ?? tool });
      return;
    }

    // The active slide is explicit, so repeated presses go on from it even mid-scroll.
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
      case 'p':
      case 'P':
        onPresent();
        break;
      case 'b':
      case 'B':
        dispatch({ type: 'boxModeToggled' });
        break;
      case 'g':
      case 'G':
        dispatch({ type: 'showGuidesToggled' });
        break;
      case 'h':
      case 'H':
        dispatch({ type: 'showHiddenSlidesToggled' });
        break;
      case 'c':
      case 'C':
        // An open draft keeps its mark – the composer takes the key as text.
        if (!canComment || draft) return;
        startComment({ onHoveredBox: true });
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    // Installed at startup already (main.tsx); here for anything mounting the viewer without it.
    watchPointer();
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  // Holding ⌥ flips box mode for one quick comment: a free spot while box mode is on, a box
  // while it is off. Any other key with ⌥ (a shortcut, a typed character) or leaving the window
  // ends it.
  useEffect(() => {
    const flip = (flipped: boolean) => dispatch({ type: 'boxModeFlipped', flipped });
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Alt') flip(true);
      else if (event.altKey) flip(false);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === 'Alt') flip(false);
    };
    const reset = () => flip(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [dispatch]);
}
