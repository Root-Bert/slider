import { DEFAULT_MEETING_NOTICE, type CalendarEvent } from '@slider/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCalendarEvents, useMe } from '@/lib/api';
import { CLOUD_EVENT_PARAM, routes } from '@/lib/routes';
import { Icon, cn } from '@/ui';
import { iso, midnight, plus, todayNoon } from './days';
import { JoinMeeting } from './MeetingField';

/** How often the notice looks at the clock: its „in 4 Min“ stays right to the minute. */
const TICK_MS = 15_000;
/** The day's events asked again now and then: a mailbox's change shows without a reload. */
const REFRESH_MS = 5 * 60_000;

/** The minute ticking on, for the notice's words. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The meeting at hand: the first with a meeting (a call, a link) whose start is no more than
 * `lead` minutes away, until it ends – whole-day ones never.
 */
export function meetingAt(
  events: readonly CalendarEvent[],
  now: number,
  lead: number,
): CalendarEvent | null {
  return (
    events
      .filter((event) => event.meeting && !event.allDay)
      .filter(
        (event) => Date.parse(event.start) - lead * 60_000 <= now && now < Date.parse(event.end),
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null
  );
}

/** „in 4 Min“, „jetzt“, „seit 12 Min“. */
export function whenWords(start: number, now: number): string {
  const minutes = Math.round((start - now) / 60_000);
  if (minutes > 0) return `in ${minutes} Min`;
  if (minutes === 0) return 'jetzt';
  return `seit ${-minutes} Min`;
}

/**
 * Left of the date in the header (Cloud, Sender): the meeting coming up, from as many minutes
 * before as one set (Einstellungen › Kalender, default 5; off: never) until it ends. A click opens
 * it in the calendar; pointing at it (or on it with Tab, or on a touch screen at once) „Beitreten“
 * joins it – a call in Slider where one is, a link outside.
 */
export function MeetingNotice({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const setting = useMe().data?.user?.meetingNoticeMinutes;
  const lead = setting === undefined ? DEFAULT_MEETING_NOTICE : setting;
  const now = useNow();
  // One range a day (from today's midnight through tomorrow): the calendar's live changes reach it.
  const today = todayNoon();
  const from = midnight(today).toISOString();
  const to = midnight(plus(today, 2)).toISOString();
  const events = useCalendarEvents(workspaceId, from, to, lead !== null, REFRESH_MS);
  if (lead === null) return null;
  const meeting = meetingAt(events.data ?? [], now, lead);
  if (!meeting?.meeting) return null;
  const start = Date.parse(meeting.start);
  const open = () => {
    const path = routes.cloudCalendar(workspaceId, iso(new Date(start)));
    void navigate(
      `${path}${path.includes('?') ? '&' : '?'}${CLOUD_EVENT_PARAM}=${encodeURIComponent(meeting.id)}`,
    );
  };
  const soon = start > now;
  return (
    // „Beitreten“ lies over the time when pointed at (its column is as wide): the notice keeps its
    // place by the date and the title its ellipsis.
    <div className="group relative flex min-w-0 shrink items-center max-sm:hidden">
      <button
        type="button"
        onClick={open}
        title={`${meeting.title} im Kalender öffnen`}
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-control px-2 text-sm hover:bg-hover"
      >
        <span
          aria-hidden
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full',
            soon ? 'bg-info/15 text-info' : 'bg-success/15 text-success',
          )}
        >
          <Icon name="videocam" size={13} />
        </span>
        <span className="max-w-44 truncate text-fg">{meeting.title}</span>
        <span className="min-w-21 shrink-0 text-fg-muted tabular-nums group-focus-within:invisible group-hover:invisible pointer-coarse:invisible">
          {whenWords(start, now)}
        </span>
      </button>
      <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 group-focus-within:flex group-hover:flex pointer-coarse:flex">
        <JoinMeeting meeting={meeting.meeting} size="xs" />
      </span>
    </div>
  );
}
