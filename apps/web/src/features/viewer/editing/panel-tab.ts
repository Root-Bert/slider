import { useSyncExternalStore } from 'react';

/** A part of the format panel, picked in the row of tabs at its foot (`FormatBar`). */
export type PanelTab = 'text' | 'fill' | 'image' | 'arrange';

/** The part picked last – kept for the next element that has it, set by a new frame's kind. */
let pickedTab: PanelTab = 'text';
const tabListeners = new Set<() => void>();
export const setPickedTab = (tab: PanelTab) => {
  pickedTab = tab;
  for (const listener of tabListeners) listener();
};
export const usePickedTab = () =>
  useSyncExternalStore(
    (listener) => {
      tabListeners.add(listener);
      return () => tabListeners.delete(listener);
    },
    () => pickedTab,
  );

type FilledKind = 'text' | 'shape' | 'image' | 'symbol';

/** The part a new element of a frame's kind opens on: its text, a shape's fill, the picture. */
export const KIND_TABS: Record<FilledKind, PanelTab> = {
  text: 'text',
  shape: 'fill',
  image: 'image',
  symbol: 'image',
};
/** A new frame filled: its panel opens on the part its preview showed (`FramePanelPreview`). */
export const openPanelOn = (kind: FilledKind) => setPickedTab(KIND_TABS[kind]);

/** New picture frames taken as „Symbol“: their picture part is the symbols' (`isSymbol`). */
const symbolFrames = new Set<string>();
export const markSymbolFrame = (elementId: string) => void symbolFrames.add(elementId);
export const isSymbolFrame = (elementId: string) => symbolFrames.has(elementId);
