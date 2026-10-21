import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerState } from '../../state/viewer-state';
import { locateCursor } from '../lib/cursor-anchor';
import { connectLive, setPresence } from '../lib/live-store';

/** Several changes in a row (a reply plus resolve) → one refetch. */
const COMMENTS_REFETCH_DELAY_MS = 120;

/**
 * Realtime for the open deck (BER-104): keeps the live stream open, refetches comments when
 * someone changes them, and reports this viewer's active slide and pointer to the others.
 */
export function useLive() {
  const { deck } = useViewerData();
  const { activeSlideId, focusedThreadId } = useViewerState();
  const queryClient = useQueryClient();
  const deckId = deck.id;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchComments = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) });
      }, COMMENTS_REFETCH_DELAY_MS);
    };
    const disconnect = connectLive(deckId, refetchComments);
    return () => {
      if (timer) clearTimeout(timer);
      disconnect();
    };
  }, [deckId, queryClient]);

  useEffect(() => {
    setPresence({ activeSlideId });
  }, [activeSlideId]);

  // The comment open here (expanded card or thread panel) is marked for the others.
  useEffect(() => {
    setPresence({ focusedThreadId });
  }, [focusedThreadId]);

  // The pointer over a slide (hidden for the others anywhere else). Scrolling moves slides under a
  // resting pointer: it is located again then.
  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    const report = (target: EventTarget | null, x: number, y: number) => {
      const element = target instanceof Element ? target : null;
      setPresence({ cursor: locateCursor(element, x, y) });
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      last = { x: event.clientX, y: event.clientY };
      report(event.target, event.clientX, event.clientY);
    };
    const onScroll = () => {
      if (last) report(document.elementFromPoint(last.x, last.y), last.x, last.y);
    };
    const hide = () => {
      last = null;
      setPresence({ cursor: null });
    };
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    // Capture: the track and the comment area scroll in elements of their own.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll, { capture: true });
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
