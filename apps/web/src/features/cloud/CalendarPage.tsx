import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { useCalendarEvents, useCalendars, useTodos } from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import { createStoredStore } from '@/lib/storage';
import {
  CLOUD_DAY_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
  CLOUD_VIEW_PARAM,
} from '@/lib/routes';
import {
  Button,
  GlassPanel,
  IconButton,
  LoadingState,
  SegmentedControl,
  useMediaQuery,
} from '@/ui';
import { CloudPage } from './components/CloudPage';
import { CalendarAside } from './components/calendar/CalendarAside';
import { useHiddenCalendars } from './components/calendar/CalendarList';
import {
  AgendaView,
  MonthView,
  TimeGridView,
  YearView,
  type ViewProps,
} from './components/calendar/CalendarViews';
import { at, iso, todayNoon } from './components/calendar/days';
import {
  CALENDAR_VIEWS,
  stepped,
  toEntries,
  VIEW_LABELS,
  viewDays,
  viewRange,
  viewTitle,
  type CalendarView,
} from './components/calendar/entries';
import { useShownEvent } from './components/calendar/EventPanel';
import { useBusyDays } from './components/calendar/useBusyDays';
import { useCloud } from './hooks/useCloud';
import { useStoredChoice } from './hooks/useStoredChoice';

const VIEWS = {
  tag: TimeGridView,
  woche: TimeGridView,
  monat: MonthView,
  jahr: YearView,
  agenda: AgendaView,
} satisfies Record<CalendarView, (props: ViewProps) => React.ReactNode>;

/** Keys as Google's calendar: T today, ← → back and on, D W M J A the views. */
const VIEW_KEYS: Record<string, CalendarView> = {
  d: 'tag',
  w: 'woche',
  m: 'monat',
  j: 'jahr',
  a: 'agenda',
};

/**
 * „Kalender“: the areas' calendars, one's own and the mail accounts' – by day, week, month, year or
 * as a list, with the weeks' numbers; beside them which are shown, the to-dos as one of them. An
 * event opens beside it, a click where nothing is makes a new one there.
 */
export function Component() {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const [params, setParams] = useSearchParams();
  const [lastView, setLastView] = useStoredChoice<CalendarView>(
    `slider.calendar.view:${workspaceId}`,
    CALENDAR_VIEWS,
    'monat',
  );
  const asked = params.get(CLOUD_VIEW_PARAM) as CalendarView | null;
  const view = asked && CALENDAR_VIEWS.includes(asked) ? asked : lastView;
  const day = params.get(CLOUD_DAY_PARAM);
  const anchor = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? at(day) : todayNoon();
  const calendars = useCalendars(workspaceId);
  const range = viewRange(view, anchor);
  const events = useCalendarEvents(workspaceId, range.from, range.to);
  const todos = useTodos(workspaceId);
  const { hidden, toggle } = useHiddenCalendars(workspaceId);
  const shownEvent = useShownEvent();
  const busy = useBusyDays(workspaceId, anchor);
  const wide = useMediaQuery(WIDE);
  const [asideOpen, setAsideOpen] = useCalendarAside();
  // Narrow, the column lies over the days: opened from its switch each time, not remembered.
  const [narrowOpen, setNarrowOpen] = useState(false);
  const setShown = wide ? setAsideOpen : setNarrowOpen;
  // An event, a to-do or a file open beside: the column steps aside for it (one thing beside at a
  // time), and comes back as it closes.
  const besidePanel = [CLOUD_EVENT_PARAM, CLOUD_TODO_PARAM, CLOUD_FILE_PARAM].some((key) =>
    params.has(key),
  );
  const shown = (wide ? asideOpen : narrowOpen) && !besidePanel;
  const toggleAside = () => {
    if (!besidePanel) return setShown(!shown);
    setShown(true);
    setParams(
      (current) => {
        const after = new URLSearchParams(current);
        // With a new event's day and hour (`EventPanel`).
        for (const key of [
          CLOUD_EVENT_PARAM,
          CLOUD_TODO_PARAM,
          CLOUD_FILE_PARAM,
          'neu-tag',
          'neu-um',
        ])
          after.delete(key);
        return after;
      },
      { replace: true },
    );
  };
  const go = (next: { view?: CalendarView; day?: string | null }) => {
    if (next.view) setLastView(next.view);
    setParams(
      (current) => {
        const after = new URLSearchParams(current);
        if (next.view) after.set(CLOUD_VIEW_PARAM, next.view);
        if (next.day === null) after.delete(CLOUD_DAY_PARAM);
        else if (next.day) after.set(CLOUD_DAY_PARAM, next.day);
        return after;
      },
      { replace: true },
    );
  };
  const step = (by: 1 | -1) => go({ day: iso(stepped(view, anchor, by)) });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright') {
      if (
        (event.target as HTMLElement).closest('[role="grid"], [role="group"], [role="radiogroup"]')
      )
        return;
      step(key === 'arrowleft' ? -1 : 1);
    } else if (key === 't') go({ day: null });
    else if (VIEW_KEYS[key]) go({ view: VIEW_KEYS[key] });
    else return;
    event.preventDefault();
  });
  // Back from signing a mailbox in anew (its calendars): the sign-in's mark goes.
  useEffect(() => {
    if (!params.has('anmeldung')) return;
    setParams(
      (current) => {
        const after = new URLSearchParams(current);
        after.delete('anmeldung');
        return after;
      },
      { replace: true },
    );
  }, [params, setParams]);
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const canPut = (calendars.data ?? []).some((each) => each.canEdit);
  const entries = toEntries(events.data ?? [], calendars.data ?? [], todos.data ?? [], hidden);
  const View = VIEWS[view];
  const isToday = iso(anchor) === iso(todayNoon());
  return (
    <CloudPage
      docTitle="Kalender"
      title="Kalender"
      crumbs={[{ label: ui.workspace.name }, { label: 'Kalender' }]}
      nodes={[]}
      fill
    >
      {() => (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
            {/* As on Cloud's other pages: the views and „Neuer Termin“ on the left; on the right the title, stepping through and the calendars' switch. */}
            <div className="flex flex-wrap items-center gap-2">
              <GlassPanel className="shrink-0 p-1">
                <SegmentedControl
                  label="Ansicht"
                  value={view}
                  onChange={(next) => go({ view: next })}
                  segments={CALENDAR_VIEWS.map((each) => ({
                    value: each,
                    label: VIEW_LABELS[each],
                    title: `${VIEW_LABELS[each]} (${Object.keys(VIEW_KEYS)
                      .find((key) => VIEW_KEYS[key] === each)!
                      .toUpperCase()})`,
                  }))}
                />
              </GlassPanel>
              {canPut && (
                <Button
                  icon="add"
                  onClick={() => {
                    const now = new Date();
                    const minutes = isToday ? Math.min(23, now.getHours() + 1) * 60 : 9 * 60;
                    shownEvent.create({ day: iso(anchor), minutes });
                  }}
                >
                  Neuer Termin
                </Button>
              )}
            </div>
            <h2
              className="ml-auto min-w-40 flex-1 truncate text-right text-lg font-semibold text-fg"
              aria-live="polite"
            >
              {viewTitle(view, anchor)}
            </h2>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <GlassPanel className="flex shrink-0 items-center gap-1 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isToday}
                  onClick={() => go({ day: null })}
                  title="Heute (T)"
                >
                  Heute
                </Button>
                <div role="group" aria-label="Blättern" className="flex items-center gap-1">
                  <IconButton
                    icon="chevronLeft"
                    label="Zurück (←)"
                    size="sm"
                    onClick={() => step(-1)}
                  />
                  <IconButton
                    icon="chevronRight"
                    label="Weiter (→)"
                    size="sm"
                    onClick={() => step(1)}
                  />
                </div>
              </GlassPanel>
              <AsideButton shown={shown} onToggle={toggleAside} />
            </div>
          </div>
          {/* Under the head, as „KI zur Mail“ under the folders: the days, the AI's column beside. */}
          <div className="relative flex min-h-0 flex-1 gap-6">
            <div className="flex min-w-0 flex-1 flex-col">
              {!calendars.data || !events.data ? (
                <LoadingState padding="lg" />
              ) : (
                <View
                  anchor={anchor}
                  days={viewDays(view, anchor)}
                  entries={entries}
                  onOpen={(nextView, nextDay) => go({ view: nextView, day: nextDay })}
                  onNew={canPut ? shownEvent.create : null}
                />
              )}
            </div>
            {shown && (
              <aside
                className={
                  wide
                    ? 'flex min-h-0 w-[320px] shrink-0 flex-col'
                    : 'absolute inset-0 z-10 flex min-h-0 flex-col bg-canvas'
                }
              >
                <CalendarAside
                  anchor={anchor}
                  onPick={(next) => {
                    go({ day: next });
                    if (!wide) setNarrowOpen(false);
                  }}
                  busy={busy}
                  calendars={calendars.data}
                  hidden={hidden}
                  onToggle={toggle}
                />
              </aside>
            )}
          </div>
        </div>
      )}
    </CloudPage>
  );
}

/** Wide enough for the AI's column beside the days. */
const WIDE = '(min-width: 1024px)';
const asideStore = createStoredStore<boolean>({
  key: 'slider.calendar.aside',
  parse: (value) => value !== false,
  fallback: true,
});
function useCalendarAside() {
  const open = useSyncExternalStore(asideStore.subscribe, asideStore.getSnapshot);
  return [open, asideStore.set] as const;
}

/** The switch for the AI's column at the head's end – as „KI zur Mail“ in the folders' row. */
function AsideButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <GlassPanel className="flex shrink-0 p-1">
      <IconButton
        icon={shown ? 'aiPanelOpen' : 'aiPanel'}
        label="KI zum Kalender"
        title="KI zum Kalender – Überblick, Vorschläge, Kalender"
        size="sm"
        active={shown}
        aria-expanded={shown}
        onClick={onToggle}
      />
    </GlassPanel>
  );
}
