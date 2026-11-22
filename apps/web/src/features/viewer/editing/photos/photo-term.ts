import { useState } from 'react';
import { useDebounced } from '@/ui';

/** What is typed into a photo search, and the term searched for: settled, two letters at least. */
export function usePhotoTerm(initialQuery = '', given?: string) {
  const [typed, setQuery] = useState(initialQuery);
  const query = given ?? typed;
  const settled = useDebounced(query, 400);
  // Photos at random stay until there is a search: two letters.
  const term = settled.trim().length >= 2 ? settled : '';
  return { query, setQuery, term };
}
