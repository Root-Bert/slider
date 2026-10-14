import { useRef } from 'react';
import { TextField } from '@/ui';
import { isApplePlatform, useSearchShortcut } from '../hooks/useSearchShortcut';
import { Kbd } from '@/ui';

interface DeckSearchProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Deck search (G1), in the toolbar left of the sort select. Filters client-side by title;
 * ⌘K / Ctrl K focuses it, Escape clears it.
 */
export function DeckSearch({ value, onChange }: DeckSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, true);

  return (
    <search className="w-[260px] max-sm:min-w-0 max-sm:flex-1">
      <TextField
        ref={inputRef}
        type="search"
        icon="search"
        aria-label="Reviews durchsuchen"
        placeholder="Reviews durchsuchen…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          }
        }}
        trailing={<Kbd className="max-sm:hidden">{isApplePlatform() ? '⌘K' : 'Strg K'}</Kbd>}
        className="[&_input::-webkit-search-cancel-button]:hidden"
      />
    </search>
  );
}
