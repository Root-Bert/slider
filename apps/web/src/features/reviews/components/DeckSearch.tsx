import { useRef } from 'react';
import { IconButton, Kbd, Spinner, TextField } from '@/ui';
import { isApplePlatform } from '@/lib/platform';
import { useSearchShortcut } from '../hooks/useSearchShortcut';

interface DeckSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Slides and comments are searched too, not only the names (BER-175, switched on by hand). */
  content: boolean;
  onContentChange: (content: boolean) => void;
  /** Slides and comments are being searched. */
  searching?: boolean;
}

const CONTENT_LABEL = 'Auch Folien und Kommentare durchsuchen';

/**
 * Deck search (G1), in the toolbar left of the sort select. By default it filters the names,
 * client-side; the button in the field adds the slides' text and the comments, searched on the
 * server (BER-175). ⌘K / Ctrl K focuses it, Escape clears it.
 */
export function DeckSearch({
  value,
  onChange,
  content,
  onContentChange,
  searching = false,
}: DeckSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, true);

  return (
    <search className="w-[300px] max-sm:w-full max-sm:basis-full">
      <TextField
        ref={inputRef}
        type="search"
        icon="search"
        aria-label="Reviews durchsuchen"
        placeholder={content ? 'Namen, Folien, Kommentare…' : 'Reviews durchsuchen…'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          }
        }}
        trailing={
          <span className="flex items-center gap-1.5">
            {searching ? (
              <Spinner
                size={16}
                className="text-fg-subtle"
                label="Sucht in Folien und Kommentaren"
              />
            ) : (
              <Kbd className="max-sm:hidden">{isApplePlatform() ? '⌘K' : 'Strg K'}</Kbd>
            )}
            <IconButton
              icon="textFields"
              label={CONTENT_LABEL}
              size="xs"
              active={content}
              aria-pressed={content}
              onClick={() => {
                onContentChange(!content);
                inputRef.current?.focus();
              }}
            />
          </span>
        }
        className="[&_input::-webkit-search-cancel-button]:hidden"
      />
    </search>
  );
}
