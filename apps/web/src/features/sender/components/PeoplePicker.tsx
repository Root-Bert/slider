import { useState } from 'react';
import { searchFold, type AccountAuthor } from '@slider/shared';
import { Avatar, cn, Icon, TextField } from '@/ui';

/**
 * The workspace's people to pick from, typed into where they stand: a field filters them, a
 * click picks (`multiple`: ticks one more; else picks that one at once).
 */
export function PeoplePicker({
  people,
  picked,
  multiple,
  onPick,
  autoFocus = true,
}: {
  people: readonly AccountAuthor[];
  picked: ReadonlySet<string>;
  multiple: boolean;
  onPick: (person: AccountAuthor) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const needle = searchFold(query.trim());
  const shown = people.filter((person) => searchFold(person.name).includes(needle));
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <TextField
        aria-label="Personen suchen"
        icon="search"
        placeholder="Name"
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = shown[0];
          if (first) onPick(first);
        }}
      />
      <ul
        aria-label="Personen"
        aria-multiselectable={multiple || undefined}
        role="listbox"
        className="flex max-h-80 min-h-0 flex-col gap-0.5 overflow-y-auto"
      >
        {shown.map((person) => {
          const on = picked.has(person.id);
          return (
            <li key={person.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => onPick(person)}
                className={cn(
                  'flex h-10 w-full items-center gap-3 rounded-chip px-2.5 text-left text-sm transition-colors',
                  on ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <Avatar author={person} size={24} nativeTitle={false} />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                {multiple && on && <Icon name="check" size={18} className="text-fg" />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-2.5 py-2 text-xs text-fg-subtle">
            {people.length === 0
              ? 'Außer dir ist noch niemand im Workspace.'
              : 'Niemand mit diesem Namen.'}
          </li>
        )}
      </ul>
    </div>
  );
}
