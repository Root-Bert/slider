import { MenuDivider, MenuItem } from '@/ui';
import { iso, plus, todayNoon } from '../calendar/days';
import { MonthGrid } from '../calendar/MonthGrid';

const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });

/**
 * When a to-do is due, as Linear asks it: the likely days at the top, a month to pick from under
 * them. Picked, it closes.
 */
export function DueCalendar({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (dueOn: string | null) => void;
}) {
  const today = todayNoon();
  const nextMonday = plus(today, (8 - today.getDay()) % 7 || 7);
  const quick: [string, Date][] = [
    ['Heute', today],
    ['Morgen', plus(today, 1)],
    ['Nächsten Montag', nextMonday],
    ['In einer Woche', plus(today, 7)],
  ];
  return (
    <>
      {quick.map(([label, day]) => (
        <MenuItem
          key={label}
          selected={value === iso(day)}
          onClick={() => onPick(iso(day))}
          trailing={<span className="text-xs text-fg-subtle">{weekdayFormat.format(day)}</span>}
        >
          {label}
        </MenuItem>
      ))}
      {value && <MenuItem onClick={() => onPick(null)}>Kein Datum</MenuItem>}
      <MenuDivider />
      <MonthGrid value={value} onPick={onPick} />
    </>
  );
}
