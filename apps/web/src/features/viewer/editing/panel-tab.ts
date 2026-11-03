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

/** The part a new element of a frame's kind opens on: its text, a shape's fill, the picture. */
export const KIND_TABS: Record<'text' | 'shape' | 'image', PanelTab> = {
  text: 'text',
  shape: 'fill',
  image: 'image',
};
/** A new frame filled: its panel opens on the part its preview showed (`FramePanelPreview`). */
export const openPanelOn = (kind: 'text' | 'shape' | 'image') => setPickedTab(KIND_TABS[kind]);
