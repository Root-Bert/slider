import { createContext, use, useSyncExternalStore } from 'react';
import { useBarSearch } from '../hooks/useBarSearch';

/*
 * The side bar folded, its search moves into the page's path (`CrumbSearchField`): whether it
 * stands there, and who asks for it (⇧⌘F, the bar's magnifier – `SearchPalette`).
 */

/** The bar beside the page is folded to its icons (`CloudLayout`; never below lg). */
export const BarFolded = createContext(false);

/** Marks the page's place for it, for ⇧⌘F to know the field can stand there. */
export const CRUMB_SEARCH = 'data-crumb-search';

let asked = false;
const listeners = new Set<() => void>();
/** Shows the field (empty, waiting for the first letter) – or takes it away again. */
export function askCrumbSearch(next: boolean) {
  asked = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the field stands in the path's place: folded, and asked for or searching. */
export function useCrumbSearch() {
  const folded = use(BarFolded);
  const { searching } = useBarSearch();
  const wanted = useSyncExternalStore(subscribe, () => asked);
  return folded && (wanted || searching);
}

/** Asked for right now (the field takes the typing as it appears). */
export const crumbSearchAsked = () => asked;
