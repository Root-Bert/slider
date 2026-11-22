import type { CalendarEvent } from '@slider/shared';
import { useCalendarEvents, useCalendars } from '@/lib/api';
import { routes } from '@/lib/routes';
import { TextLink, cn } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { useHiddenCalendars } from './CalendarList';
import { at, clock, iso, midnight, plus, todayNoon } from './days';
import { toEntries, type Entry } from './entries';
import { useShownEvent } from './EventPanel';

/** How far ahead „Zuletzt“ looks. */
const AHEAD_DAYS = 14;
const dayFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** „Heute“, „Morgen“, „Mo., 23. Nov.“ – and the hour unless it lasts the day. */
function when(entry: Entry, now: Date) {
  const today = todayNoon();
  // One under way since before today stands at today.
  const start = entry.start < now ? now : entry.start;
  const day = iso(start);
  const label =
    day === iso(today) ? 'Heute' : day === iso(plus(today, 1)) ? 'Morgen' : dayFormat.format(start);
  if (entry.allDay) return label;
  return entry.start < now
    ? `${label}, bis ${clock(entry.end)}`
    : `${label}, ${clock(entry.start)}`;
}

/**
 * „Anstehende Termine“ on „Zuletzt“, beside „Deine Aufgaben“: the next few of the calendars one
 * shows, each opened beside the page as in the calendar; there only while there is some.
 */
export function UpcomingEvents({ shown = 5 }: { shown?: number }) {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const today = todayNoon();
  const calendars = useCalendars(workspaceId);
  const events = useCalendarEvents(
    workspaceId,
    midnight(today).toISOString(),
    midnight(plus(today, AHEAD_DAYS)).toISOString(),
  );
  const { hidden } = useHiddenCalendars(workspaceId);
  const panel = useShownEvent();
  const now = new Date();
  const upcoming = toEntries(events.data ?? [], calendars.data ?? [], [], hidden)
    .filter((entry) => (entry.allDay ? entry.end > at(iso(today)) : entry.end > now))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (upcoming.length === 0) return null;
  return (
    <section aria-labelledby="cloud-events" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="cloud-events" className="text-base font-semibold text-fg">
          Anstehende Termine
        </h2>
        <TextLink to={routes.cloudCalendar(workspaceId, undefined, 'agenda')} size="body">
          {upcoming.length > shown ? `Alle ${upcoming.length}` : 'Kalender'}
        </TextLink>
      </div>
      <ul className="flex flex-col">
        {upcoming.slice(0, shown).map((entry) => (
          <EventRow
            key={entry.key}
            entry={entry}
            event={entry.event!}
            label={when(entry, now)}
            open={panel.id === entry.event!.id}
            onToggle={() => panel.toggle(entry.event!.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function EventRow({
  entry,
  event,
  label,
  open,
  onToggle,
}: {
  entry: Entry;
  event: CalendarEvent;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-control px-3 text-left text-sm hover:bg-hover',
          open && 'bg-selected hover:bg-selected',
        )}
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: entry.color }}
        />
        <span className="min-w-0 flex-1 truncate text-fg">{event.title}</span>
        {event.location && (
          <span className="hidden max-w-40 shrink-0 truncate text-xs text-fg-muted sm:block">
            {event.location}
          </span>
        )}
        <span className="max-w-40 shrink-0 truncate text-xs text-fg-muted">{entry.place}</span>
        <span className="min-w-26 shrink-0 text-right text-xs text-fg-muted tabular-nums">{label}</span>
      </button>
    </li>
  );
}
