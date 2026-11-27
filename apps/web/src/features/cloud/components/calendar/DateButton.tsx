import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { Button, Icon, PopoverPanel } from '@/ui';
import { dayFormat, iso, todayNoon } from './days';
import { MonthGrid } from './MonthGrid';
import { useBusyDays } from './useBusyDays';

const labelFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** „Do., 26. Nov.“ as its weekday („Do., “) and the rest. */
function labelParts(day: Date): [string, string] {
  const label = labelFormat.format(day);
  const at = label.indexOf(' ') + 1;
  return [label.slice(0, at), label.slice(at)];
}

/** Today, and again after midnight while the page stays open. */
function useToday() {
  const [today, setToday] = useState(todayNoon);
  useEffect(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 1, 0);
    const timer = window.setTimeout(() => setToday(todayNoon()), next.getTime() - Date.now());
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}

/** How long the pointer rests on the date before the small month shows, and lingers after. */
const PEEK_AFTER_MS = 250;
const PEEK_UNTIL_MS = 150;

/**
 * Today's date in the app's header (Cloud, Sender): a click opens the calendar as a page of Cloud.
 * Resting the pointer on it shows a small month – a dot where an event is or a to-do is due; a day
 * there opens the calendar on it.
 */
export function DateButton({ workspaceId }: { workspaceId: string }) {
  const today = useToday();
  const navigate = useNavigate();
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const later = (show: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(show), show ? PEEK_AFTER_MS : PEEK_UNTIL_MS);
  };
  const marked = useBusyDays(workspaceId, today, peek);
  const go = (day?: string) => {
    window.clearTimeout(timer.current);
    setPeek(false);
    void navigate(routes.cloudCalendar(workspaceId, day));
  };
  return (
    <div
      className="relative flex shrink-0"
      // A mouse only: a touch is a click and opens the calendar.
      onPointerEnter={(event) => event.pointerType === 'mouse' && later(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && later(false)}
    >
      <Button
        variant="ghost"
        weight="normal"
        onClick={() => go()}
        aria-label={`Kalender öffnen, heute ${dayFormat.format(today)}`}
        // On a phone the header has no room for the weekday, on the narrowest none for the date.
        className="tabular-nums max-sm:px-2"
      >
        <Icon name="event" size={20} className="min-[360px]:hidden" />
        <span className="whitespace-pre max-sm:hidden">{labelParts(today)[0]}</span>
        <span className="max-[359px]:hidden">{labelParts(today)[1]}</span>
      </Button>
      {peek && (
        <PopoverPanel role="dialog" aria-label="Kalender" align="end" padding="md" className="w-72">
          <MonthGrid key={iso(today)} value={null} onPick={go} marked={marked} />
        </PopoverPanel>
      )}
    </div>
  );
}
