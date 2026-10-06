import { useRef } from 'react';
import { cn, TextField } from '@/ui';
import { isApplePlatform, useSearchShortcut } from '../hooks/useSearchShortcut';
import { Kbd } from '@/ui';

interface DeckSearchProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * `header` (≥ sm): compact field in the app header with the ⌘K / Ctrl K shortcut.
   * `inline` (< sm): full-width field below the title, where the header has no room.
   */
  placement: 'header' | 'inline';
}

/** Deck search (G1). Filters client-side by title; Escape clears it. */
export function DeckSearch({ value, onChange, placement }: DeckSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isHeader = placement === 'header';
  useSearchShortcut(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, isHeader);

  return (
    <search className={cn('w-full', isHeader ? 'max-w-[312px] max-sm:hidden' : 'sm:hidden')}>
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
        trailing={isHeader && <Kbd>{isApplePlatform() ? '⌘K' : 'Strg K'}</Kbd>}
        className="[&_input::-webkit-search-cancel-button]:hidden"
      />
    </search>
  );
}
