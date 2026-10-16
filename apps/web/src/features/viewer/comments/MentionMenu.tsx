import { Avatar, cn } from '@/ui';
import type { Mentions } from './hooks/useMentions';

/**
 * The `@` suggestions above a comment field (BER-105). Sits in the field's `relative` wrapper;
 * picking keeps the focus in the field.
 */
export function MentionMenu({ mentions }: { mentions: Mentions }) {
  const { people, activeIndex, listId, optionId, pick } = mentions;
  if (people.length === 0) return null;

  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Person erwähnen"
      className="glass-elevated absolute bottom-full left-0 z-50 mb-2 flex max-h-56 w-full max-w-64 animate-pop-in flex-col overflow-y-auto rounded-control p-1"
    >
      {people.map((person, index) => (
        <li
          key={person.id}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          // Not a click: the field would lose focus (and its caret) first.
          onMouseDown={(event) => {
            event.preventDefault();
            pick(person);
          }}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-control-sm px-2 py-1.5 text-[13px] text-fg-muted',
            index === activeIndex ? 'bg-white/15 text-fg' : 'hover:bg-white/10 hover:text-fg',
          )}
        >
          <Avatar author={person} size={20} />
          <span className="truncate">{person.name}</span>
        </li>
      ))}
    </ul>
  );
}
