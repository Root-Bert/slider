import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton, cn } from '@/ui';
import {
  addMonths,
  at,
  dayFormat,
  iso,
  monthDays,
  monthFormat,
  plus,
  sameMonth,
  startOfMonth,
  todayNoon,
  WEEKDAYS,
} from './days';

/**
 * A month to pick a day from, small: the due date's picker and the header's date. Arrows step
 * through the days (a week up and down), Enter picks; the month's arrows page.
 */
export function MonthGrid({
  value,
  onPick,
  marked,
}: {
  /** The picked day, filled. */
  value: string | null;
  onPick: (day: string) => void;
  /** Days with something on them (an event, a to-do due): a dot under the number. */
  marked?: ReadonlySet<string>;
}) {
  const today = todayNoon();
  const [focus, setFocus] = useState(() => (value ? at(value) : today));
  const [month, setMonth] = useState(() => startOfMonth(focus));
  const grid = useRef<HTMLDivElement>(null);
  const stepped = useRef(false);
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${iso(focus)}"]`)?.focus();
  }, [focus]);

  const step = (days: number) => {
    const next = plus(focus, days);
    stepped.current = true;
    setFocus(next);
    if (!sameMonth(next, month)) setMonth(startOfMonth(next));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    step(by);
  };
  // The day Tab lands on: the focused one while it is shown, else the month's first.
  const tabbable = sameMonth(focus, month) ? iso(focus) : iso(month);

  return (
    <>
      <div className="flex items-center justify-between py-1 pr-0.5 pl-2">
        <span className="text-sm font-medium text-fg" aria-live="polite">
          {monthFormat.format(month)}
        </span>
        <span className="flex">
          <IconButton
            icon="chevronLeft"
            label="Voriger Monat"
            size="compact"
            onClick={() => setMonth(addMonths(month, -1))}
          />
          <IconButton
            icon="chevronRight"
            label="Nächster Monat"
            size="compact"
            onClick={() => setMonth(addMonths(month, 1))}
          />
        </span>
      </div>
      <div className="grid grid-cols-7 px-1 pb-1" role="grid" ref={grid} onKeyDown={onKeyDown}>
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="flex h-7 items-center justify-center text-xs text-fg-subtle"
            aria-hidden
          >
            {weekday}
          </span>
        ))}
        {monthDays(month).map((day) => {
          const key = iso(day);
          const picked = value === key;
          const isToday = key === iso(today);
          const dot = marked?.has(key);
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              tabIndex={key === tabbable ? 0 : -1}
              aria-pressed={picked}
              aria-label={dayFormat.format(day)}
              onFocus={() => setFocus(day)}
              onClick={() => onPick(key)}
              className={cn(
                'relative mx-auto flex size-8 items-center justify-center rounded-control-sm text-sm tabular-nums outline-none',
                'focus-visible:ring-2 focus-visible:ring-focus',
                picked
                  ? 'bg-primary font-medium text-on-primary'
                  : cn(
                      'hover:bg-hover',
                      sameMonth(day, month) ? 'text-fg' : 'text-fg-faint',
                      isToday && 'font-semibold text-danger',
                    ),
              )}
            >
              {day.getDate()}
              {dot && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    picked ? 'bg-on-primary' : 'bg-fg-subtle',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
