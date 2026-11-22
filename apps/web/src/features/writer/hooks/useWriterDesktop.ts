import { useEffect, useEffectEvent } from 'react';

/** What the document offers in the app's tab bar, top right. */
export interface WriterBarOffer {
  export: boolean;
  exportOpen: boolean;
}

/** Picked in the app's menu bar („Ablage“, „Darstellung“) or clicked in its tab bar. */
export type WriterDesktopAction =
  'new' | 'open' | 'export' | 'print' | 'close' | 'zoomIn' | 'zoomOut' | 'zoomReset';

export const WRITER_DESKTOP_EVENT = 'writer:desktop';

declare global {
  interface Window {
    /** Set by Writer's desktop app on its pages (`desktop/writer/start-preload.cjs`). */
    writerDesktop?: { docBar(offer: WriterBarOffer | null): void };
  }
}

export const writerDesktop = () =>
  typeof window === 'undefined' ? null : (window.writerDesktop ?? null);

/** In the app the tab bar closes and exports: the page leaves those buttons to it. */
export const inWriterDesktopBar = () => !!writerDesktop();

/** What the app's menu bar and tab bar ask of the page in front. */
export function useWriterDesktopActions(handle: (action: WriterDesktopAction) => void) {
  const onAction = useEffectEvent(handle);
  useEffect(() => {
    const listener = (event: Event) => onAction((event as CustomEvent<WriterDesktopAction>).detail);
    window.addEventListener(WRITER_DESKTOP_EVENT, listener);
    return () => window.removeEventListener(WRITER_DESKTOP_EVENT, listener);
  }, []);
}

/** The open document's offer to the tab bar; taken back when the page goes. */
export function useWriterDesktopBar(offer: WriterBarOffer | null) {
  const exports = offer?.export;
  const exportOpen = offer?.exportOpen;
  useEffect(() => {
    const bridge = writerDesktop();
    if (!bridge) return;
    bridge.docBar(exports === undefined ? null : { export: exports, exportOpen: !!exportOpen });
  }, [exports, exportOpen]);
  useEffect(() => () => writerDesktop()?.docBar(null), []);
}
