import { useEffect, useRef } from 'react';
import { useBarSearch } from '../hooks/useBarSearch';
import { askCrumbSearch, crumbSearchAsked } from '../lib/crumb-search';

/**
 * The side bar folded, its search moves into the page: one types where the path stands, after
 * „Suche nach:“ – nothing opens over the page. ⇧⌘F and the bar's magnifier ask for it
 * (`SearchPalette`); once a letter is typed the page is the search's (`SearchResults`), whose
 * path is this field again.
 */

export function CrumbSearchField() {
  const { query, setQuery } = useBarSearch();
  const input = useRef<HTMLInputElement>(null);
  // Asked for, it takes the typing; mounted anew while typing (the page turns into the search's
  // at the first letter), the typing goes on – but it takes no focus from another field.
  useEffect(() => {
    const field = input.current;
    const elsewhere = document.activeElement && document.activeElement !== document.body;
    if (!field || (!crumbSearchAsked() && elsewhere)) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  return (
    <label data-cloud-search="page" className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="shrink-0 text-fg-subtle">Suche nach:</span>
      <input
        ref={input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (event.target.value) askCrumbSearch(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          setQuery('');
          askCrumbSearch(false);
          event.currentTarget.blur();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.value) askCrumbSearch(false);
        }}
        aria-label="Dateien, Bereiche, Chats, Personen und Mails suchen"
        placeholder="Name oder was in einer Datei steht"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
      />
    </label>
  );
}
