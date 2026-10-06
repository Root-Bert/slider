import { useCallback, useSyncExternalStore, type RefObject } from 'react';

const subscribe = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

/** Fullscreen API on a given element (the viewer root, so overlays stay visible). */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const isFullscreen = useSyncExternalStore(subscribe, () => document.fullscreenElement !== null);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void targetRef.current?.requestFullscreen().catch(() => undefined);
  }, [targetRef]);

  return { isFullscreen, toggle, isSupported: document.fullscreenEnabled };
}
