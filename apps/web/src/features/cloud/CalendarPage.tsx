import type { Calendar, Todo } from '@slider/shared';
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'react-router';
import { useCalendarPage, useCalendars, useTodos } from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import { createStoredStore } from '@/lib/storage';
import {
  CLOUD_DAY_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
  CLOUD_VIEW_PARAM,
  routes,
} from '@/lib/routes';
import {
  Button,
  ButtonLink,
  GlassPanel,
  IconButton,
  LoadingState,
  SegmentedControl,
  useMediaQuery,
} from '@/ui';
import { CloudPage } from './components/CloudPage';
import { CalendarAside } from './components/calendar/CalendarAside';
import { GIVE_WAY_TO_PANEL } from './lib/panel';
import { useCalendarOAuthOutcome } from './components/calendar/CalendarAccounts';
import { useHiddenCalendars } from './components/calendar/CalendarList';
import {
  AgendaView,
  MonthView,
  TimeGridView,
  YearView,
  type ViewProps,
} from './components/calendar/CalendarViews';
import { CalendarStrip, type StripHandle } from './components/calendar/CalendarStrip';
import { at, iso, startOfWeek, todayNoon } from './components/calendar/days';
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
import { useShownEvent, type NewEvent } from './components/calendar/EventPanel';
import {
  finishZoom,
  startZoom,
  stopZoom,
  useZoomGestures,
  ZOOM_CHAIN,
  zoomLevel,
  type ZoomDrive,
  type ZoomStart,
} from './components/calendar/zoom';
import { useBusyDays } from './components/calendar/useBusyDays';
import { CalendarSourceTabs } from './components/calendar/CalendarSourceTabs';
import { hiddenIn, useCalendarSource } from './components/calendar/sources';
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
  const anchorDay = iso(anchor);
  const calendars = useCalendars(workspaceId);
  const todos = useTodos(workspaceId);
  const { hidden, toggle } = useHiddenCalendars(workspaceId);
  // The source atop the page (`?quelle=`): its calendars alone, as one mailbox in Post.
  const source = useCalendarSource(calendars.data);
  const shownHidden = hiddenIn(hidden, calendars.data, source);
  useCalendarOAuthOutcome();
  const shownEvent = useShownEvent();
  const busy = useBusyDays(workspaceId, anchor, true, source);
  const wide = useMediaQuery(WIDE);
  const [asideOpen, setAsideOpen] = useCalendarAside();
  // Narrow, the column lies over the days: opened from its switch each time, not remembered.
  const [narrowOpen, setNarrowOpen] = useState(false);
  const setShown = wide ? setAsideOpen : setNarrowOpen;
  // A panel open beside (an event, a to-do, a file, the AI's chat): wide, the column stays and the
  // panel slides in over it (`data-page-aside`, `CloudLayout`); narrow, the column gives way to an
  // event, to-do or file (one thing over the days at a time) and comes back as it closes.
  const besidePanel = [CLOUD_EVENT_PARAM, CLOUD_TODO_PARAM, CLOUD_FILE_PARAM].some((key) =>
    params.has(key),
  );
  const shown = wide ? asideOpen : narrowOpen && !besidePanel;
  const toggleAside = () => {
    if (wide || !besidePanel) return setShown(!shown);
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
          'neu-meeting',
          'am',
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
  const frameRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<StripHandle>(null);
  const zooming = useRef<ZoomStart | null>(null);
  /**
   * The day one chose (a day's number, a pinch on a day, the side's small month): framed where a
   * view shows it. Paging, a year's month, another view choose none (the day they land on, a
   * month's 1st, is not one's).
   */
  const [chosen, setChosen] = useState<string | null>(null);
  /** The day a slide is for (a day picked in the next month stays picked, not the month's 1st). */
  const sliding = useRef<{ by: 1 | -1; day: string | null } | null>(null);
  /**
   * Another view or day, as everything asks for it (the views' switch, their keys, a day's number,
   * a pinch, the column's month): another view zooms (`zoom.ts`), the page beside slides in,
   * anything further is there at once.
   */
  const navigate = (
    nextView: CalendarView,
    nextDay: Date,
    { drive, chosen: choosing = false }: { drive?: ZoomDrive; chosen?: boolean } = {},
  ) => {
    // A slide cut short by this (a zoom, a day further away) is for nothing any more.
    sliding.current = null;
    if (choosing) setChosen(iso(nextDay));
    const day = iso(nextDay) === iso(todayNoon()) ? null : iso(nextDay);
    if (nextView === view) {
      const target = pageKey(view, nextDay);
      if (target === pageKey(view, anchor)) return go({ day });
      for (const by of [1, -1] as const) {
        if (target !== pageKey(view, stepped(view, anchor, by))) continue;
        sliding.current = { by, day };
        if (stripRef.current?.slide(by)) return;
        sliding.current = null;
      }
      return go({ day });
    }
    const frame = frameRef.current;
    const pane = frame?.querySelector<HTMLElement>('[data-pane="0"]');
    if (frame && overlayRef.current && pane) {
      zooming.current = startZoom({
        frame,
        overlay: overlayRef.current,
        pane,
        from: view,
        to: nextView,
        day: nextDay,
        drive,
        title: titleRef.current,
      });
    }
    // A pinch let go short of the way: the view and day as they were, the old page's copy cleared
    // once they are there again.
    if (drive) {
      const before = { view, day: params.get(CLOUD_DAY_PARAM) };
      const chosenBefore = chosen;
      drive.back = (done) => {
        leaving.current = done;
        setChosen(chosenBefore);
        go(before);
      };
    }
    go({ view: nextView, day });
  };
  const leaving = useRef<(() => void) | null>(null);
  useEffect(() => stopZoom, []);
  useLayoutEffect(() => {
    leaving.current?.();
    leaving.current = null;
    const start = zooming.current;
    if (!start) return;
    zooming.current = null;
    const pane = frameRef.current?.querySelector<HTMLElement>('[data-pane="0"]');
    if (pane) finishZoom(start, pane);
    else start.overlay.replaceChildren();
  }, [view, anchorDay]);
  useZoomGestures(frameRef, (direction, x, y, drive) => {
    const level = zoomLevel(view);
    const nextView = level === undefined ? undefined : ZOOM_CHAIN[level - direction];
    if (!nextView) return false;
    // In: what is under the fingers (a day, a year's month); out: around the day one is on.
    const hit =
      direction === 1
        ? document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day], [data-month]')
        : null;
    // The day one is on stays picked where it lies in the month pinched (its own month, say).
    const day = hit?.dataset.day
      ? at(hit.dataset.day)
      : hit?.dataset.month && hit.dataset.month !== iso(anchor).slice(0, 7)
        ? at(`${hit.dataset.month}-01`)
        : anchor;
    navigate(nextView, day, { drive, chosen: Boolean(hit?.dataset.day) });
    return true;
  });
  const step = (by: 1 | -1) => {
    sliding.current = null;
    if (!stripRef.current?.slide(by)) go({ day: iso(stepped(view, anchor, by)) });
  };
  const onStep = (by: 1 | -1) => {
    const asked = sliding.current;
    sliding.current = null;
    go({ day: asked?.by === by ? asked.day : iso(stepped(view, anchor, by)) });
  };
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
    } else if (key === 't') navigate(view, todayNoon());
    else if (VIEW_KEYS[key]) navigate(VIEW_KEYS[key], anchor);
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const canPut = (calendars.data ?? []).some((each) => each.canEdit);
  const isToday = iso(anchor) === iso(todayNoon());
  return (
    <CloudPage
      docTitle="Kalender"
      title={<CalendarSourceTabs calendars={calendars.data} source={source} />}
      crumbs={[{ label: 'Kalender' }]}
      // As „Postfächer“ beside Post: the accounts whose calendars stand here.
      actions={
        <ButtonLink
          to={routes.cloudCalendarAccounts(workspaceId)}
          variant="ghost"
          icon="settings"
          size="sm"
        >
          Konten
        </ButtonLink>
      }
      nodes={[]}
      fill
    >
      {() => (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className={`flex flex-wrap items-center gap-x-2 gap-y-3 ${GIVE_WAY_TO_PANEL}`}>
            {/* The views on the left; on the right the title, stepping through and the calendars' switch. A new event or meeting: „Neu“ in the side bar or a click in the grid (the user: no buttons for them here). */}
            {/* On a phone the views take a line of their own (scrolling sideways where even that
                is too narrow), the title and the paging the next. */}
            <div className="flex flex-wrap items-center gap-2 max-sm:basis-full">
              <GlassPanel className="shrink-0 p-1 max-sm:max-w-full max-sm:overflow-x-auto max-sm:[scrollbar-width:none]">
                <SegmentedControl
                  label="Ansicht"
                  value={view}
                  onChange={(next) => navigate(next, anchor)}
                  segments={CALENDAR_VIEWS.map((each) => ({
                    value: each,
                    label: VIEW_LABELS[each],
                    title: `${VIEW_LABELS[each]} (${Object.keys(VIEW_KEYS)
                      .find((key) => VIEW_KEYS[key] === each)!
                      .toUpperCase()})`,
                  }))}
                />
              </GlassPanel>
            </div>
            {/* Word by word: zoomed, a word both titles have moves to its place, the others fade
                (`zoom.ts`). */}
            <h2
              ref={titleRef}
              className="ml-auto min-w-40 flex-1 truncate text-right text-lg font-semibold text-fg max-sm:min-w-0 max-sm:text-left"
              aria-live="polite"
            >
              {viewTitle(view, anchor)
                .split(' ')
                .map((word, index) => (
                  <Fragment key={index}>
                    {index > 0 && ' '}
                    <span data-word className="inline-block">
                      {word}
                    </span>
                  </Fragment>
                ))}
            </h2>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <GlassPanel className="flex shrink-0 items-center gap-1 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isToday}
                  onClick={() => navigate(view, todayNoon())}
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
            {/* A panel over the column (400 + 12 from the edge) reaches 44px past it (24 page edge
                + 320 column + 24 gap): the days give way that far and 12px more – the room every
                page keeps beside a panel – as it slides in. */}
            {/* The pages side by side (swiped through), pinched for another view; what flies
                between two views flies over them (`overlayRef`, `zoom.ts`). */}
            <div
              ref={frameRef}
              className={`relative flex min-w-0 flex-1 touch-pan-x touch-pan-y flex-col transition-[margin] duration-300 ease-out ${
                wide && shown ? '[body:has([data-cloud-panel])_&]:mr-14' : ''
              }`}
            >
              {!calendars.data ? (
                <LoadingState padding="lg" />
              ) : (
                <CalendarStrip
                  ref={stripRef}
                  onStep={onStep}
                  onStay={() => (sliding.current = null)}
                  pages={
                    ([-1, 0, 1] as const).map((by) => {
                      const day = by ? stepped(view, anchor, by as 1 | -1) : anchor;
                      return {
                        key: pageKey(view, day),
                        node: (
                          <CalendarPane
                            workspaceId={workspaceId}
                            view={view}
                            anchor={day}
                            calendars={calendars.data}
                            todos={todos.data ?? []}
                            hidden={shownHidden}
                            picked={shownEvent.day ?? chosen}
                            onOpen={(nextView, nextDay) =>
                              // A day's number is a day chosen; a year's month is not (its 1st).
                              navigate(nextView, at(nextDay), { chosen: nextView === 'tag' })
                            }
                            onDay={shownEvent.showDay}
                            onNew={canPut ? shownEvent.create : null}
                          />
                        ),
                      };
                    }) as [StripPageNode, StripPageNode, StripPageNode]
                  }
                />
              )}
              <div
                ref={overlayRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
              />
            </div>
            {shown && (
              <aside
                data-page-aside={wide || undefined}
                className={
                  wide
                    ? 'flex min-h-0 w-[320px] shrink-0 flex-col'
                    : 'absolute inset-0 z-10 flex min-h-0 flex-col bg-canvas'
                }
              >
                <CalendarAside
                  anchor={anchor}
                  onPick={(next) => {
                    navigate(view, at(next), { chosen: true });
                    if (!wide) setNarrowOpen(false);
                  }}
                  busy={busy}
                  calendars={calendars.data}
                  hidden={hidden}
                  source={source}
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

type StripPageNode = { key: string; node: React.ReactNode };

/** A page's name in the strip: the same page keeps it while it moves from beside to the middle. */
function pageKey(view: CalendarView, day: Date) {
  switch (view) {
    case 'woche':
      return `woche:${iso(startOfWeek(day))}`;
    case 'monat':
      return `monat:${iso(day).slice(0, 7)}`;
    case 'jahr':
      return `jahr:${day.getFullYear()}`;
    default:
      return `${view}:${iso(day)}`;
  }
}

/** A page of the calendar: its days, and its events asked for alone (the ones beside ahead). */
function CalendarPane({
  workspaceId,
  view,
  anchor,
  calendars,
  todos,
  hidden,
  picked,
  onOpen,
  onDay,
  onNew,
}: {
  workspaceId: string;
  view: CalendarView;
  anchor: Date;
  calendars: readonly Calendar[];
  todos: readonly Todo[];
  hidden: ReadonlySet<string>;
  picked: ViewProps['picked'];
  onOpen: ViewProps['onOpen'];
  onDay: ViewProps['onDay'];
  onNew: ((draft: NewEvent) => void) | null;
}) {
  const range = viewRange(view, anchor);
  const events = useCalendarPage(workspaceId, range.from, range.to);
  const View = VIEWS[view];
  return (
    <View
      anchor={anchor}
      days={viewDays(view, anchor)}
      entries={toEntries(events.data ?? [], calendars, todos, hidden)}
      picked={picked}
      onOpen={onOpen}
      onDay={onDay}
      onNew={onNew}
    />
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
