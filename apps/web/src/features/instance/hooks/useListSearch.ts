import { useState } from 'react';
import { useDebounced } from './useDebounced';

const SEARCH_DEBOUNCE_MS = 250;

/** The typed search, sent once typing pauses, and the page – a new search starts at the top. */
export function useListSearch() {
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState({ q, offset: 0 });
  // A new search starts at the top.
  const offset = page.q === q ? page.offset : 0;
  return {
    typed,
    setTyped,
    q,
    offset,
    setOffset: (next: number) => setPage({ q, offset: next }),
  };
}
