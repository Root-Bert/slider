import { useEffect, useEffectEvent } from 'react';

/*
 * Reader's desktop app (`desktop/reader`), as Writer's (`features/writer/hooks/useWriterDesktop`):
 * its menu bar and tab bar speak to the page in front through the `reader:desktop` event, the
 * open PDF tells the tab bar what it offers through `window.readerDesktop`.
 */

/** What the PDF offers in the app's tab bar, top right. */
export interface ReaderBarOffer {
  export: boolean;
  exportOpen: boolean;
}

/** Picked in the app's menu bar („Ablage“) or clicked in its tab bar. */
export type ReaderDesktopAction = 'open' | 'export' | 'print' | 'close';

export const READER_DESKTOP_EVENT = 'reader:desktop';

declare global {
  interface Window {
    /** Set by Reader's desktop app on its pages (`desktop/reader/start-preload.cjs`). */
    readerDesktop?: { docBar(offer: ReaderBarOffer | null): void };
  }
}

export const readerDesktop = () =>
  typeof window === 'undefined' ? null : (window.readerDesktop ?? null);

/** In the app the tab bar prints, exports and closes: the page leaves those buttons to it. */
export const inReaderDesktopBar = () => !!readerDesktop();

/** What the app's menu bar and tab bar ask of the page in front. */
export function useReaderDesktopActions(handle: (action: ReaderDesktopAction) => void) {
  const onAction = useEffectEvent(handle);
  useEffect(() => {
    const listener = (event: Event) => onAction((event as CustomEvent<ReaderDesktopAction>).detail);
    window.addEventListener(READER_DESKTOP_EVENT, listener);
    return () => window.removeEventListener(READER_DESKTOP_EVENT, listener);
  }, []);
}

/** The open PDF's offer to the tab bar; taken back when the page goes. */
export function useReaderDesktopBar(offer: ReaderBarOffer | null) {
  const exports = offer?.export;
  const exportOpen = offer?.exportOpen;
  useEffect(() => {
    const bridge = readerDesktop();
    if (!bridge) return;
    bridge.docBar(exports === undefined ? null : { export: exports, exportOpen: !!exportOpen });
  }, [exports, exportOpen]);
  useEffect(() => () => readerDesktop()?.docBar(null), []);
}
