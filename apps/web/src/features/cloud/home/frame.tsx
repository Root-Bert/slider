import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useAccount } from '@/features/auth';
import type { CloudSelection } from '../components/CloudPage';
import type { WidgetInfo } from './kit';
import type { Widget } from './layout';

/*
 * What every board's widgets share („Zuletzt“, „Aktuell“, a mailbox's „Übersicht“): what a widget
 * knows of the page and of its own frame, its heading, its quiet empty line – and the widgets on
 * every board, the time with a greeting and a note.
 */

/** What a widget needs of the page around it. */
export interface HomePage {
  /** „Zuletzt geändert“: the page's files, as `CloudPage` lets them be picked („Zuletzt“ only). */
  selection?: CloudSelection | undefined;
  /** The widgets are being arranged: nothing in them reacts. */
  editing: boolean;
  /** A note's words changed. */
  onText: (id: string, text: string) => void;
}
export const HomePageContext = createContext<HomePage | null>(null);
export const useHomePage = () => use(HomePageContext)!;

/** The widget round what is drawn: its name, whether its heading shows, the heading's id. */
interface Frame {
  widget: Widget;
  /** Its kind's name (`BoardKit.info`) – its heading. */
  label: string;
  headingId: string;
  /** How much wider it is on the page than now (while arranging, the panel beside). */
  widen: number;
}
export const FrameContext = createContext<Frame | null>(null);
export const useFrame = () => use(FrameContext)!;

/**
 * A widget's heading – with a link or a spinner at its end; hidden where the widget's heading is
 * switched off (its link too: the widget alone is left).
 */
export function WidgetHead({ action }: { action?: ReactNode }) {
  const frame = use(FrameContext)!;
  if (!frame.widget.title) return null;
  return (
    <div className="flex shrink-0 items-baseline justify-between gap-3 pb-2">
      <h2 id={frame.headingId} className="min-w-0 truncate text-base font-semibold text-fg">
        {frame.label}
      </h2>
      {action}
    </div>
  );
}

/** What a widget shows while it has nothing: a quiet line, so it stays there to be seen. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="text-body text-fg-subtle">{children}</p>;
}

/* ---------- Heute ---------- */

/** Ticks once a minute, at the minute. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(
        () => {
          setNow(new Date());
          next();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    next();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

function greeting(hour: number) {
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function TodayWidget() {
  const { user } = useAccount();
  const now = useMinute();
  const first = user.name.trim().split(/\s+/)[0];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-body text-fg-muted">
        {greeting(now.getHours())}
        {first ? `, ${first}` : ''}
      </p>
      <p className="text-[44px] leading-none font-semibold tracking-tight text-fg tabular-nums">
        {timeFormat.format(now)}
      </p>
      <p className="text-sm text-fg-muted">{dateFormat.format(now)}</p>
    </div>
  );
}

/* ---------- Notiz ---------- */

function NoteWidget() {
  const frame = use(FrameContext)!;
  const page = useHomePage();
  return (
    <>
      <WidgetHead />
      <textarea
        aria-label="Notiz"
        value={frame.widget.text ?? ''}
        onChange={(event) => page.onText(frame.widget.id, event.target.value)}
        placeholder="Etwas notieren …"
        className="min-h-16 w-full flex-1 resize-none bg-transparent text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
      />
    </>
  );
}

/** On every board (`SHARED_DEFAULTS`). */
export const SHARED_INFO = {
  today: { label: 'Heute', icon: 'schedule', about: 'Datum, Uhrzeit und ein Gruß' },
  note: { label: 'Notiz', icon: 'notes', about: 'Ein paar eigene Zeilen' },
} as const satisfies Record<string, WidgetInfo>;

/** On every board (`SHARED_DEFAULTS`). */
export const SHARED_VIEWS = { today: TodayWidget, note: NoteWidget };
