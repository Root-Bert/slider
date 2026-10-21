import { useCallback, type RefObject } from 'react';

/** Toggles fullscreen on a given element (the viewer root, so overlays stay visible). */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  return useCallback(() => {
    if (!document.fullscreenEnabled) return;
    // Both reject when the browser refuses (e.g. already leaving): nothing to do then.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void targetRef.current?.requestFullscreen().catch(() => undefined);
  }, [targetRef]);
}
