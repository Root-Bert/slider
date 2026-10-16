import { useEffect } from 'react';
import { useViewerDispatch } from '../../state/viewer-state';

/**
 * While `active` (a typed reply, an open voice/video/sketch dialog), the thread stays in the
 * comment column even if it stops matching the status filter – someone else may resolve it
 * meanwhile, and the card must not unmount with the draft or the recording in it.
 */
export function useKeepThreadListed(threadId: string, active: boolean) {
  const dispatch = useViewerDispatch();
  useEffect(() => {
    if (!active) return;
    dispatch({ type: 'composingChanged', threadId, composing: true });
    return () => dispatch({ type: 'composingChanged', threadId, composing: false });
  }, [active, threadId, dispatch]);
}
