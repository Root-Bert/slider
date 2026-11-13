import { useRef } from 'react';
import { IconButton, Kbd, Spinner, TextField } from '@/ui';
import { isApplePlatform } from '@/lib/platform';
import { useSearchShortcut } from '../hooks/useSearchShortcut';

interface ViewSearchProps {
  /** "Präsentationen durchsuchen" – the field's name, and its placeholder (with "…"). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * What the button adds to the names – "Auch Folien und Kommentare durchsuchen". Without it (and
   * `onContentChange`) no button: `content` says what is always searched.
   */
  contentLabel?: string;
  /** The placeholder while it is on – "Namen, Folien, Kommentare…". */
  contentPlaceholder: string;
  /** The contents are searched too, not only the names (switched on by hand). */
  content: boolean;
  onContentChange?: (content: boolean) => void;
  /** The contents are being searched (on the server). */
  searching?: boolean;
}

/**
 * The search of a workspace's views (Präsentationen, Bibliothek), in the toolbar left of the
 * sort select. By default it filters the names; the button in the field adds the contents –
 * a deck's slides and comments (BER-175), a template's layouts, a font's stand-ins and origin.
 * ⌘K / Ctrl K focuses it, Escape clears it.
 */
export function ViewSearch({
  label,
  value,
  onChange,
  contentLabel,
  contentPlaceholder,
  content,
  onContentChange,
  searching = false,
}: ViewSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, true);

  return (
    <search className="block w-88 max-w-full max-sm:w-full">
      <TextField
        ref={inputRef}
        type="search"
        icon="search"
        aria-label={label}
        placeholder={content ? contentPlaceholder : `${label}…`}
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
              <Spinner size={16} className="text-fg-subtle" label="Sucht in den Inhalten" />
            ) : (
              <Kbd className="max-sm:hidden">{isApplePlatform() ? '⌘K' : 'Strg K'}</Kbd>
            )}
            {contentLabel && onContentChange && (
              <IconButton
                icon="textFields"
                label={contentLabel}
                size="xs"
                active={content}
                aria-pressed={content}
                onClick={() => {
                  onContentChange(!content);
                  inputRef.current?.focus();
                }}
              />
            )}
          </span>
        }
        className="[&_input::-webkit-search-cancel-button]:hidden"
      />
    </search>
  );
}
