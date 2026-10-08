import { useCallback, type RefObject } from 'react';

/** Toggles fullscreen on a given element (the viewer root, so overlays stay visible). */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  return useCallback(() => {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void targetRef.current?.requestFullscreen().catch(() => undefined);
  }, [targetRef]);
}
