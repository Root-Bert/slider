import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useSearchParams } from 'react-router';

const QUERY = 'suche';
const PLACE = 'ort';
const OWNER = 'von';

/** The page's „Ort“: everywhere, one's own files, what others shared, or one area (its id). */
export type SearchPlace = '' | 'own' | 'shared' | (string & {});
const PLACE_WORDS: Record<string, SearchPlace> = { meine: 'own', geteilt: 'shared' };
const placeWord = (place: SearchPlace) =>
  place === 'own' ? 'meine' : place === 'shared' ? 'geteilt' : place;

/*
 * What was typed, at once, for every field and page that shows it (the bar's, the path's, the
 * hits) – the address follows a moment later: a navigation is a transition, and a field read back
 * from it lost what was typed fast („Bericht“ became „t“). Only on the page it was typed on, until
 * the address caught up with it – or „Zurück“/„Vor“ made the address the truth again.
 */
let typed: { text: string; path: string } | null = null;
const listeners = new Set<() => void>();
const setTyped = (next: typeof typed) => {
  typed = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
if (typeof window !== 'undefined') window.addEventListener('popstate', () => setTyped(null));

/**
 * The side bar's search lives in the address (`?suche=…&ort=…&von=…`): the bar shows what is
 * called so, the page what is called so or says so (`SearchResults`), narrowed by where it lies
 * and whose it is. The first letter is a step back's worth – „Zurück“ ends the search –, the
 * others replace it; going anywhere ends it.
 */
export function useBarSearch() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const inAddress = params.get(QUERY) ?? '';
  const ahead = useSyncExternalStore(subscribe, () => typed);
  const query = ahead && ahead.path === pathname ? ahead.text : inAddress;
  useEffect(() => {
    if (typed?.text === inAddress) setTyped(null);
  }, [inAddress]);
  const placeParam = params.get(PLACE) ?? '';
  const place: SearchPlace = PLACE_WORDS[placeParam] ?? placeParam;
  const owner = params.get(OWNER) ?? '';
  const set = (key: string, value: string, replace: boolean) =>
    setParams(
      (now) => {
        const after = new URLSearchParams(now);
        if (value) after.set(key, value);
        else after.delete(key);
        // The search gone, what narrowed it goes with it.
        if (key === QUERY && !value) {
          after.delete(PLACE);
          after.delete(OWNER);
        }
        return after;
      },
      { replace },
    );
  return {
    query,
    setQuery: (next: string) => {
      setTyped({ text: next, path: pathname });
      set(QUERY, next, query !== '');
    },
    place,
    setPlace: (next: SearchPlace) => set(PLACE, placeWord(next), true),
    owner,
    setOwner: (next: string) => set(OWNER, next, true),
    searching: query.trim() !== '',
  };
}
