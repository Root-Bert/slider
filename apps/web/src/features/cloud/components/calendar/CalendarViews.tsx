import { isOpenTodo } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/ui';
import { StatusMark } from '../todos/TodoMarks';
import { useShownTodo } from '../todos/TodoList';
import {
  clock,
  dayFormat,
  iso,
  midnight,
  monthDays,
  monthFormat,
  sameMonth,
  startOfWeek,
  todayNoon,
  WEEKDAYS,
  weekNumber,
} from './days';
import { byDay, entryDays, type CalendarView, type Entry } from './entries';
import { useShownEvent, type NewEvent } from './EventPanel';

/** What every view is given: its days, what lies in them, and where a click goes. */
export interface ViewProps {
  anchor: Date;
  days: Date[];
  entries: Entry[];
  /** Another view of a day (a day's number, „+3 weitere“, a day in the year). */
  onOpen: (view: CalendarView, day: string) => void;
  /** A new event where the click was – `null` where nothing may be put in. */
  onNew: ((draft: NewEvent) => void) | null;
}

const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** An entry's look: its calendar's colour as a bar and a tint, as Apple's. */
function useOpenEntry() {
  const shownEvent = useShownEvent();
  const shownTodo = useShownTodo();
  return {
    isOpen: (entry: Entry) =>
      entry.event ? shownEvent.id === entry.event.id : shownTodo.id === entry.todo?.id,
    open: (entry: Entry) =>
      entry.event ? shownEvent.toggle(entry.event.id) : shownTodo.toggle(entry.todo!.id),
  };
}

function EntryChip({
  entry,
  day,
  showTime = true,
}: {
  entry: Entry;
  /** The day it stands in (one on each of its days): what it flies to and from (`zoom.ts`). */
  day: string;
  showTime?: boolean;
}) {
  const { isOpen, open } = useOpenEntry();
  const done = entry.todo && !isOpenTodo(entry.todo.status);
  const picked = isOpen(entry);
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={(event) => {
        event.stopPropagation();
        open(entry);
      }}
      title={entry.allDay ? entry.title : `${clock(entry.start)} ${entry.title}`}
      data-morph={`e:${entry.key}@${day}`}
      style={{ '--entry': entry.color } as CSSProperties}
      className={cn(
        'flex h-5.5 w-full min-w-0 shrink-0 items-center gap-1.5 rounded-control-sm px-1.5 text-left text-xs',
        entry.allDay && !entry.todo
          ? 'bg-[color-mix(in_srgb,var(--entry)_22%,transparent)] text-fg hover:bg-[color-mix(in_srgb,var(--entry)_32%,transparent)]'
          : 'hover:bg-hover',
        picked && 'shadow-[inset_0_0_0_1.5px_var(--entry)]',
        done ? 'text-fg-muted line-through decoration-fg-faint' : 'text-fg',
      )}
    >
      {entry.todo ? (
        <StatusMark status={entry.todo.status} size={12} />
      ) : (
        !entry.allDay && <span className="size-2 shrink-0 rounded-full bg-(--entry)" aria-hidden />
      )}
      {showTime && !entry.allDay && (
        // Only where the day is wide enough for its title too (beside the AI's column it is not).
        <span className="hidden shrink-0 text-fg-subtle tabular-nums @[8.5rem]:inline">
          {clock(entry.start)}
        </span>
      )}
      <span className="truncate">{entry.title}</span>
    </button>
  );
}

/** A day's number: today's red, a click opens the day. */
function DayNumber({
  day,
  faint = false,
  onOpen,
}: {
  day: Date;
  faint?: boolean;
  onOpen: ViewProps['onOpen'];
}) {
  const isToday = iso(day) === iso(todayNoon());
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen('tag', iso(day));
      }}
      aria-label={dayFormat.format(day)}
      data-morph={`n:${iso(day)}`}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums',
        // Over a cell that shows its own hover: one step stronger, today a ring round the red.
        isToday
          ? 'bg-danger font-semibold text-white hover:ring-3 hover:ring-danger/30'
          : faint
            ? 'text-fg-faint hover:bg-selected hover:text-fg'
            : 'text-fg hover:bg-selected',
      )}
    >
      {day.getDate()}
    </button>
  );
}

/** The KW column's head and cells: narrow, faint, as Outlook's. */
const KW = 'flex w-9 shrink-0 justify-center text-[11px] text-fg-faint tabular-nums';
const ENTRY_ROW = 24;
/** How many entries a month's day held last: a page swiped or zoomed in starts with it. */
/** How many entries fit a day, by the month's number of weeks – known at once the next time
 * (a zoom takes the month as first drawn): a month of five weeks fits more than one of six. */
const lastFit = new Map<number, number>();

/** The month: its weeks fill the page; a day shows as many entries as fit, the rest „+3“. */
export function MonthView({ anchor, days, entries, onOpen, onNew }: ViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = days.length / 7;
  const [fit, setFit] = useState(() => lastFit.get(weeks) ?? 3);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const row = (grid.clientHeight - 36) / weeks;
      const fits = Math.max(1, Math.floor((row - 34) / ENTRY_ROW));
      lastFit.set(weeks, fits);
      setFit(fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [weeks]);
  const daysOf = byDay(entries);
  // The day one went to is framed – not today, its red number says it.
  const picked = iso(anchor) === iso(todayNoon()) ? null : iso(anchor);
  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={monthFormat.format(anchor)}
      className="glass grid min-h-0 flex-1 overflow-hidden rounded-panel"
      style={{
        gridTemplateColumns: '2.25rem repeat(7, minmax(0, 1fr))',
        gridTemplateRows: `2.25rem repeat(${weeks}, minmax(0, 1fr))`,
      }}
    >
      <span aria-hidden className={cn(KW, 'items-center')}>
        KW
      </span>
      {WEEKDAYS.map((weekday) => (
        <span key={weekday} aria-hidden className="flex items-center px-3 text-xs text-fg-subtle">
          {weekday}
        </span>
      ))}
      {days.map((date, index) => {
        const key = iso(date);
        const here = daysOf.get(key) ?? [];
        const shown = here.length > fit ? here.slice(0, fit - 1) : here;
        const outside = !sameMonth(date, anchor);
        return [
          index % 7 === 0 && (
            <span
              key={`kw${key}`}
              aria-hidden
              data-seg
              data-week={key}
              className={cn(KW, 'border-t border-hairline pt-2.5')}
            >
              {weekNumber(date)}
            </span>
          ),
          <div
            key={key}
            role="gridcell"
            aria-label={`${dayFormat.format(date)}${here.length ? `, ${here.length} Einträge` : ''}`}
            data-seg
            data-day={key}
            data-week={iso(startOfWeek(date))}
            onClick={onNew ? () => onNew({ day: key }) : undefined}
            className={cn(
              '@container flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-t border-l border-hairline p-1',
              outside ? 'bg-surface-1 hover:bg-hover' : 'hover:bg-surface-1',
              key === picked && 'shadow-[inset_0_0_0_2px_var(--color-border-focus)]',
            )}
          >
            <DayNumber day={date} faint={outside} onOpen={onOpen} />
            {shown.map((entry) => (
              <EntryChip key={entry.key} entry={entry} day={key} />
            ))}
            {shown.length < here.length && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen('tag', key);
                }}
                className="h-5.5 shrink-0 rounded-control-sm px-1.5 text-left text-xs text-fg-subtle hover:bg-hover"
              >
                {here.length - shown.length} weitere
              </button>
            )}
          </div>,
        ];
      })}
    </div>
  );
}

const HOUR = 48;
const minutesOf = (instant: Date, day: Date) =>
  Math.min(24 * 60, Math.max(0, (instant.getTime() - midnight(day).getTime()) / 60_000));

/** Side by side where they overlap, as every calendar does: each a column of its cluster. */
function layoutDay(entries: Entry[], day: Date) {
  const placed: { entry: Entry; top: number; bottom: number; column: number; columns: number }[] =
    [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...cluster.map((each) => each.column + 1));
    for (const each of cluster) each.columns = columns;
    cluster = [];
  };
  for (const entry of [...entries].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const top = minutesOf(entry.start, day);
    const bottom = Math.max(top + 20, minutesOf(entry.end, day));
    if (top >= clusterEnd) close();
    const taken = new Set(cluster.filter((each) => each.bottom > top).map((each) => each.column));
    let column = 0;
    while (taken.has(column)) column++;
    const one = { entry, top, bottom, column, columns: 1 };
    cluster.push(one);
    placed.push(one);
    clusterEnd = Math.max(clusterEnd, bottom);
  }
  close();
  return placed;
}

/** The current time as a red line, moved on each minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * Where the hours are scrolled to, shared by the days and weeks: the week swiped in beside and the
 * day zoomed into show the same hours (the events move only sideways).
 */
const hours = { top: null as number | null };

/** A day or a week: the all-day row on top, the hours under it, scrolled to the morning. */
export function TimeGridView({ days, entries, onOpen, onNew }: ViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const daysOf = byDay(entries);
  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  useLayoutEffect(() => {
    // The working day in sight, as Google's: from an hour before now, at most from 7.
    const hour = Math.min(7, Math.max(0, new Date().getHours() - 1));
    scrollRef.current?.scrollTo({ top: hours.top ?? Math.max(0, hour * HOUR - 12) });
  }, []);
  /** The pages beside follow (`CalendarStrip`): swiped in, they show the same hours. */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.closest('[data-pane]')?.getAttribute('data-pane') !== '0') return;
    hours.top = el.scrollTop;
    for (const other of el.closest('[data-strip]')?.querySelectorAll<HTMLElement>('[data-hours]') ??
      []) {
      if (other !== el && Math.abs(other.scrollTop - el.scrollTop) > 1)
        other.scrollTop = el.scrollTop;
    }
  };
  const week = days.length > 1;
  return (
    <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel">
      {/* Head and hours keep the same room for the hours' scroll bar (shown always where macOS is
          set so): their columns line up. */}
      <div
        className="grid shrink-0 overflow-hidden border-b border-hairline [scrollbar-gutter:stable]"
        style={{ gridTemplateColumns: columns }}
      >
        <span
          aria-hidden
          className="flex items-end justify-center pb-1 text-[11px] text-fg-faint tabular-nums"
        >
          {week ? `KW ${weekNumber(days[0]!)}` : ''}
        </span>
        {days.map((day) => {
          const key = iso(day);
          const allDay = (daysOf.get(key) ?? []).filter((entry) => entry.allDay);
          return (
            <div
              key={key}
              data-seg
              data-day={key}
              className="flex min-w-0 flex-col gap-0.5 border-l border-hairline p-1"
            >
              <div className="flex items-center gap-1.5 px-1 text-xs text-fg-subtle">
                {week && <span>{WEEKDAYS[(day.getDay() + 6) % 7]}</span>}
                <DayNumber day={day} onOpen={onOpen} />
              </div>
              {allDay.map((entry) => (
                <EntryChip key={entry.key} entry={entry} day={key} />
              ))}
            </div>
          );
        })}
      </div>
      <div
        ref={scrollRef}
        data-scroller
        data-hours
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
      >
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR }}>
          <div aria-hidden className="relative">
            {Array.from({ length: 23 }, (_, index) => (
              <span
                key={index}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-faint tabular-nums"
                style={{ top: (index + 1) * HOUR }}
              >
                {String(index + 1).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const key = iso(day);
            const timed = (daysOf.get(key) ?? []).filter((entry) => !entry.allDay);
            const isToday = key === iso(todayNoon());
            return (
              <div
                key={key}
                role="gridcell"
                aria-label={dayFormat.format(day)}
                data-seg
                data-day={key}
                onClick={
                  onNew
                    ? (event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        const half = Math.floor(((event.clientY - box.top) / HOUR) * 2);
                        const minutes = Math.min(23 * 60 + 30, Math.max(0, half * 30));
                        onNew({ day: key, minutes });
                      }
                    : undefined
                }
                className="relative border-l border-hairline bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_47px,var(--color-hairline)_47px,var(--color-hairline)_48px)]"
              >
                {/* The hour one points at, under the events: a click makes a new one there. */}
                {onNew &&
                  Array.from({ length: 24 }, (_, hour) => (
                    <span
                      key={hour}
                      aria-hidden
                      className="absolute inset-x-0 hover:bg-surface-1"
                      style={{ top: hour * HOUR, height: HOUR }}
                    />
                  ))}
                {layoutDay(timed, day).map(({ entry, top, bottom, column, columns: of }) => (
                  <TimedEntry
                    key={entry.key}
                    entry={entry}
                    day={key}
                    style={{
                      top: (top / 60) * HOUR,
                      height: Math.max(20, ((bottom - top) / 60) * HOUR - 2),
                      left: `calc(${(column / of) * 100}% + 2px)`,
                      width: `calc(${100 / of}% - 4px)`,
                    }}
                  />
                ))}
                {isToday && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger before:absolute before:-top-1 before:-left-1 before:size-2.5 before:rounded-full before:bg-danger"
                    style={{ top: (minutesOf(now, day) / 60) * HOUR }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimedEntry({ entry, day, style }: { entry: Entry; day: string; style: CSSProperties }) {
  const { isOpen, open } = useOpenEntry();
  const picked = isOpen(entry);
  const short = Number(style.height) < 40;
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={(event) => {
        event.stopPropagation();
        open(entry);
      }}
      title={`${clock(entry.start)}–${clock(entry.end)} ${entry.title}`}
      data-morph={`e:${entry.key}@${day}`}
      className={cn(
        'absolute flex min-w-0 flex-col overflow-hidden rounded-control-sm border-l-[3px] px-1.5 py-0.5 text-left text-xs text-fg',
        short && 'flex-row items-center gap-1.5',
        picked && 'z-10 shadow-elevated',
      )}
      style={{
        ...style,
        borderColor: entry.color,
        backgroundColor: tint(entry.color, picked ? 40 : 22),
      }}
    >
      <span className="min-w-0 truncate font-medium">{entry.title}</span>
      <span className="min-w-0 truncate text-fg-muted tabular-nums">
        {clock(entry.start)}
        {!short && entry.location ? ` | ${entry.location}` : ''}
      </span>
    </button>
  );
}

/** The year: its twelve months small, a dot under each day with something in it. */
export function YearView({ anchor, entries, onOpen }: ViewProps) {
  const daysOf = byDay(entries);
  const today = iso(todayNoon());
  const scrollRef = useRef<HTMLDivElement>(null);
  const month = iso(anchor).slice(0, 7);
  useLayoutEffect(() => {
    // The month one comes from in sight (zoomed out of November, November is there to land in).
    const scroller = scrollRef.current;
    const section = scroller?.querySelector<HTMLElement>(`[data-month="${month}"]`);
    if (!scroller || !section) return;
    const top = section.offsetTop - scroller.offsetTop;
    if (top + section.offsetHeight > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + section.offsetHeight - scroller.clientHeight;
  }, [month]);
  return (
    <div
      ref={scrollRef}
      data-scroller
      className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-5 overflow-y-auto"
    >
      {Array.from({ length: 12 }, (_, index) => {
        const month = new Date(anchor.getFullYear(), index, 1, 12);
        const days = monthDays(month);
        return (
          <section
            key={index}
            data-seg
            data-month={iso(month).slice(0, 7)}
            className="flex flex-col gap-1"
          >
            <button
              type="button"
              onClick={() => onOpen('monat', iso(month))}
              className={cn(
                'self-start rounded-control-sm px-1 text-sm font-semibold hover:bg-hover',
                sameMonth(month, todayNoon()) ? 'text-danger' : 'text-fg',
              )}
            >
              {new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(month)}
            </button>
            <div className="grid grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] text-center text-[11px]">
              <span aria-hidden className="text-fg-faint">
                KW
              </span>
              {WEEKDAYS.map((weekday) => (
                <span key={weekday} aria-hidden className="text-fg-subtle">
                  {weekday.slice(0, 1)}
                </span>
              ))}
              {days.map((date, cell) => {
                const key = iso(date);
                const outside = !sameMonth(date, month);
                const busy = !outside && daysOf.has(key);
                return [
                  cell % 7 === 0 && (
                    <span
                      key={`kw${key}`}
                      aria-hidden
                      className="flex h-7 items-center justify-center text-fg-faint tabular-nums"
                    >
                      {weekNumber(date)}
                    </span>
                  ),
                  outside ? (
                    <span key={key} aria-hidden />
                  ) : (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onOpen('tag', key)}
                      aria-label={`${dayFormat.format(date)}${busy ? `, ${daysOf.get(key)!.length} Einträge` : ''}`}
                      data-day={key}
                      data-week={iso(startOfWeek(date))}
                      data-morph={`n:${key}`}
                      className={cn(
                        'relative mx-auto flex size-7 items-center justify-center rounded-full tabular-nums',
                        key === today
                          ? 'bg-danger font-semibold text-white'
                          : 'text-fg hover:bg-hover',
                      )}
                    >
                      {date.getDate()}
                      {busy && (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute bottom-0.5 size-1 rounded-full',
                            key === today ? 'bg-white' : 'bg-fg-subtle',
                          )}
                        />
                      )}
                    </button>
                  ),
                ];
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const agendaDay = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** The list: day by day what is coming, only days with something in them. */
export function AgendaView({ days, entries, onOpen }: ViewProps) {
  const { isOpen, open } = useOpenEntry();
  const daysOf = byDay(entries);
  const today = iso(todayNoon());
  const filled = days.filter((day) => daysOf.has(iso(day)));
  if (!filled.length) {
    return <p className="px-3 text-sm text-fg-muted">In diesen vier Wochen steht nichts an.</p>;
  }
  return (
    <div data-scroller className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {filled.map((day) => {
        const key = iso(day);
        return (
          <section key={key} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-4">
            <button
              type="button"
              onClick={() => onOpen('tag', key)}
              className={cn(
                'flex h-9 items-center gap-2 self-start rounded-control px-3 text-left text-sm whitespace-nowrap hover:bg-hover',
                key === today ? 'font-semibold text-danger' : 'text-fg',
              )}
            >
              {agendaDay.format(day)}
              <span className="text-xs font-normal text-fg-faint tabular-nums">
                KW {weekNumber(day)}
              </span>
            </button>
            <ul className="flex flex-col">
              {daysOf.get(key)!.map((entry) => {
                const days = entryDays(entry);
                const when = entry.allDay
                  ? days.length > 1
                    ? `Tag ${days.indexOf(key) + 1}/${days.length}`
                    : 'Ganztägig'
                  : `${iso(entry.start) === key ? clock(entry.start) : '00:00'} – ${iso(new Date(entry.end.getTime() - 1)) === key ? clock(entry.end) : '24:00'}`;
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      aria-pressed={isOpen(entry)}
                      onClick={() => open(entry)}
                      className={cn(
                        'flex h-9 w-full min-w-0 items-center gap-3 rounded-control px-3 text-left text-sm hover:bg-hover',
                        isOpen(entry) && 'bg-selected hover:bg-selected',
                      )}
                    >
                      <span className="w-28 shrink-0 text-fg-subtle tabular-nums">{when}</span>
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
                          entry.todo && !isOpenTodo(entry.todo.status)
                            ? 'text-fg-muted line-through'
                            : 'text-fg',
                        )}
                      >
                        {entry.title}
                      </span>
                      {entry.location && (
                        <span className="truncate text-fg-subtle">{entry.location}</span>
                      )}
                      <span className="ml-auto shrink-0 truncate text-xs text-fg-faint">
                        {entry.place}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
