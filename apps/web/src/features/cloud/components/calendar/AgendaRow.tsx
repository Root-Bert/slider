import { isOpenTodo } from '@slider/shared';
import { cn } from '@/ui';
import { StatusMark } from '../todos/TodoMarks';
import { clock, iso } from './days';
import { entryDays, type Entry } from './entries';

/** An entry as a row of a list of days (the agenda, a day beside): when, its mark, what, where. */
export function AgendaRow({
  entry,
  day,
  pressed,
  compact = false,
  onClick,
}: {
  entry: Entry;
  /** The day the row stands under: a timed entry over midnight shows its part of it. */
  day: string;
  pressed: boolean;
  /** Narrow (a day beside): the time tighter, the place left to the event. */
  compact?: boolean;
  onClick: () => void;
}) {
  const days = entryDays(entry);
  const when = entry.allDay
    ? days.length > 1
      ? `Tag ${days.indexOf(day) + 1}/${days.length}`
      : 'Ganztägig'
    : `${iso(entry.start) === day ? clock(entry.start) : '00:00'} – ${iso(new Date(entry.end.getTime() - 1)) === day ? clock(entry.end) : '24:00'}`;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-3 rounded-control px-3 text-left text-sm hover:bg-hover',
        pressed && 'bg-selected hover:bg-selected',
      )}
    >
      <span className={cn('shrink-0 text-fg-subtle tabular-nums', compact ? 'w-24' : 'w-28')}>
        {when}
      </span>
      {entry.todo ? (
        <StatusMark status={entry.todo.status} size={14} />
      ) : (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: entry.color }}
          aria-hidden
        />
      )}
      <span
        className={cn(
          'truncate',
          entry.todo && !isOpenTodo(entry.todo.status) ? 'text-fg-muted line-through' : 'text-fg',
        )}
      >
        {entry.title}
      </span>
      {entry.location && !compact && (
        <span className="truncate text-fg-subtle">{entry.location}</span>
      )}
      <span className="ml-auto shrink-0 truncate text-xs text-fg-faint">{entry.place}</span>
    </button>
  );
}
