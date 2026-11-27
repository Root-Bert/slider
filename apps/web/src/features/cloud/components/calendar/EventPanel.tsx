import type {
  Attachment,
  Calendar,
  CalendarEvent,
  CalendarEventChange,
  EventMeeting,
  EventRepeat,
  EventScope,
} from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router';
import {
  useCalendarEvents,
  useCalendarPage,
  useCalendars,
  useCreateEvent,
  useDeleteEvent,
  useTodos,
  useUpdateEvent,
} from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import {
  CLOUD_CALL_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
} from '@/lib/routes';
import { readString, writeString } from '@/lib/storage';
import {
  AutosizeTextarea,
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  Menu,
  SidePanel,
  Toggle,
  cn,
} from '@/ui';
import {
  AttachButton,
  AttachmentChips,
  SentAttachments,
  useAttachments,
} from '@/features/attachments';
import { useCloud } from '../../hooks/useCloud';
import { Picker, useShownTodo } from '../todos/TodoList';
import { AgendaRow } from './AgendaRow';
import { useHiddenCalendars } from './CalendarList';
import { CalendarPicker } from './CalendarPicker';
import { at, clock, iso, midnight, plus } from './days';
import { byDay, colorOf, toEntries, viewRange } from './entries';
import { isWorkspaceOwn } from '../../lib/areas';
import { lastCalendarKey, plainEventCalendar } from '../../lib/event-calendar';
import { hiddenIn, sourceOf, useCalendarSource } from './sources';
import { MeetingField, meetingLinkIn, useCallPlaces } from './MeetingField';
import { MonthGrid } from './MonthGrid';
import { RepeatField, ScopeDialog } from './RepeatField';

/** A new event's start, from where it was asked for: a day, and on a time grid its minute. */
export interface NewEvent {
  day: string;
  minutes?: number;
  /** „Neues Meeting“: at a time, a call in its area's conversation where its calendar is one's. */
  meeting?: boolean;
}

const NEW = 'neu';
const NEW_DAY = 'neu-tag';
const NEW_AT = 'neu-um';
/** A day clicked in the calendar: `?termin=tag&am=2026-11-27` – what is in it. */
const DAY = 'tag';
const DAY_AT = 'am';
const NEW_MEETING = 'neu-meeting';

/** The event beside the page (`?termin=`): one panel at a time – a to-do's or file's makes way. */
export function useShownEvent() {
  const [params, setParams] = useSearchParams();
  const id = params.get(CLOUD_EVENT_PARAM);
  const set = (next: string | null, draft?: NewEvent, day?: string) =>
    setParams(
      (current) => {
        const after = new URLSearchParams(current);
        if (next) after.set(CLOUD_EVENT_PARAM, next);
        else after.delete(CLOUD_EVENT_PARAM);
        after.delete(NEW_DAY);
        after.delete(NEW_AT);
        after.delete(NEW_MEETING);
        after.delete(DAY_AT);
        if (day) after.set(DAY_AT, day);
        if (draft) {
          after.set(NEW_DAY, draft.day);
          if (draft.minutes !== undefined) after.set(NEW_AT, String(draft.minutes));
          if (draft.meeting) after.set(NEW_MEETING, '1');
        }
        after.delete(CLOUD_TODO_PARAM);
        after.delete(CLOUD_FILE_PARAM);
        after.delete(CLOUD_CALL_PARAM);
        return after;
      },
      { replace: true },
    );
  const day = params.get(DAY_AT);
  return {
    id,
    /** The day shown beside, its entries listed. */
    day: id === DAY && day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    draft:
      id === NEW
        ? {
            day: params.get(NEW_DAY) ?? iso(new Date()),
            minutes: params.has(NEW_AT) ? Number(params.get(NEW_AT)) : undefined,
            meeting: params.has(NEW_MEETING),
          }
        : null,
    toggle: (eventId: string) => set(id === eventId ? null : eventId),
    create: (draft: NewEvent) => set(NEW, draft),
    showDay: (next: string) => set(DAY, undefined, next),
    close: () => set(null),
  };
}

/** What the panel edits: an event's fields as typed, days and times apart. */
interface Fields {
  calendarId: string;
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  startDay: string;
  startTime: string;
  /** All-day: the last day (shown inclusive, kept exclusive). */
  endDay: string;
  endTime: string;
  meeting: EventMeeting | null;
  repeat: EventRepeat | null;
}

/** The zone a series is walked in: the person's (its 9:00 stays 9:00 across DST). */
const ownZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function fieldsOf(event: CalendarEvent): Fields {
  const start = event.allDay ? at(event.start) : new Date(event.start);
  const end = event.allDay ? plus(at(event.end), -1) : new Date(event.end);
  return {
    calendarId: event.calendarId,
    title: event.title,
    location: event.location,
    notes: event.notes,
    allDay: event.allDay,
    startDay: iso(start),
    startTime: event.allDay ? '09:00' : clock(start),
    endDay: iso(end),
    endTime: event.allDay ? '10:00' : clock(end),
    meeting: event.meeting ?? null,
    repeat: event.repeat ?? null,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** „9“, „930“, „9:30“, „9.30“ → „09:30“; anything else `null`. */
export function parseTime(text: string): string | null {
  const digits = text.trim().replace(/\s*(uhr|h)$/i, '');
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(digits);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  return hours < 24 && minutes < 60 ? `${pad(hours)}:${pad(minutes)}` : null;
}

const instant = (day: string, time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  const date = midnight(at(day));
  date.setHours(hours ?? 0, minutes ?? 0);
  return date;
};

/** The fields as the server takes them; `null` where they do not make an event (end before start). */
function timing(fields: Fields) {
  if (fields.allDay) {
    if (fields.endDay < fields.startDay) return null;
    return { allDay: true, start: fields.startDay, end: iso(plus(at(fields.endDay), 1)) };
  }
  const start = instant(fields.startDay, fields.startTime);
  const end = instant(fields.endDay, fields.endTime);
  if (end <= start) return null;
  return { allDay: false, start: start.toISOString(), end: end.toISOString() };
}

/**
 * An event in the side panel beside the page, as a to-do: its title typed in place, when, where
 * and in which calendar under it. A change is kept at once; a new one is put in with Enter or
 * „Termin anlegen“. Esc or ✕ closes it.
 */
export function EventPanel() {
  const ui = useCloud();
  const shown = useShownEvent();
  const calendars = useCalendars(ui.workspace.id, shown.id !== null);
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!shown.id || event.key !== 'Escape' || event.defaultPrevented) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    shown.close();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  if (!shown.id || !calendars.data) return null;
  if (shown.id === DAY && !shown.day) return null;
  return (
    <SidePanel
      aria-label={shown.day ? 'Tag' : shown.draft ? 'Neuer Termin' : 'Termin'}
      data-cloud-panel
    >
      {shown.day ? (
        <DayAgenda day={shown.day} calendars={calendars.data} onClose={shown.close} />
      ) : shown.draft ? (
        <NewEventForm
          key={`${shown.draft.day}:${shown.draft.minutes ?? ''}:${shown.draft.meeting ? 'm' : ''}`}
          draft={shown.draft}
          calendars={calendars.data}
          onClose={shown.close}
          onCreated={(event) => shown.toggle(event.id)}
        />
      ) : (
        <ShownEvent
          id={shown.id}
          calendars={calendars.data}
          onClose={shown.close}
          onMoved={shown.toggle}
        />
      )}
    </SidePanel>
  );
}

const fullDay = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * A day clicked in the calendar, as Apple's: what is in it, each a click away; „Neuer Termin“ on
 * it (a double click on the day makes one at once).
 */
function DayAgenda({
  day,
  calendars,
  onClose,
}: {
  day: string;
  calendars: Calendar[];
  onClose: () => void;
}) {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const shown = useShownEvent();
  const shownTodo = useShownTodo();
  const todos = useTodos(workspaceId);
  const { hidden } = useHiddenCalendars(workspaceId);
  const source = useCalendarSource(calendars);
  const range = viewRange('tag', at(day));
  const events = useCalendarPage(workspaceId, range.from, range.to);
  const entries =
    byDay(
      toEntries(
        events.data ?? [],
        calendars,
        todos.data ?? [],
        hiddenIn(hidden, calendars, source),
      ),
    ).get(day) ?? [];
  return (
    <Shell title={fullDay.format(at(day))} closeLabel="Tag schließen (Esc)" onClose={onClose}>
      {calendars.some((each) => each.canEdit) && (
        <Button
          variant="secondary"
          size="sm"
          icon="add"
          className="self-start"
          onClick={() => shown.create({ day })}
        >
          Neuer Termin
        </Button>
      )}
      {entries.length > 0 ? (
        <ul className="-mx-3 flex flex-col">
          {entries.map((entry) => (
            <li key={entry.key}>
              <AgendaRow
                entry={entry}
                day={day}
                pressed={false}
                compact
                onClick={() =>
                  entry.event ? shown.toggle(entry.event.id) : shownTodo.toggle(entry.todo!.id)
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        events.data && <p className="text-sm text-fg-muted">An diesem Tag steht nichts an.</p>
      )}
    </Shell>
  );
}

/** The event from whichever range holds it – the page's – or, opened by link, asked for alone. */
function ShownEvent({
  id,
  calendars,
  onClose,
  onMoved,
}: {
  id: string;
  calendars: Calendar[];
  onClose: () => void;
  /** Moved to or from a mailbox's calendar: it stays open under its new id. */
  onMoved: (id: string) => void;
}) {
  const ui = useCloud();
  const found = useEventById(ui.workspace.id, id);
  const update = useUpdateEvent(ui.workspace.id);
  // Which of a series it changes, asked once while the panel stays open (a new series split
  // off from it – „following“ – is changed as a whole after).
  const [remembered, setRemembered] = useState<{ series: string; scope: EventScope } | null>(null);
  useEffect(() => {
    if (found === null) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it is gone
  }, [found === null]);
  if (!found) return null;
  return (
    <EventForm
      key={found.id}
      event={found}
      calendars={calendars}
      onClose={onClose}
      scope={remembered && remembered.series === found.seriesId ? remembered.scope : null}
      onChange={(change, files) =>
        update.mutate(
          { id: found.id, change, ...(files && { files }) },
          {
            onSuccess: (event) => {
              if (change.scope && change.scope !== 'one' && event.seriesId) {
                setRemembered({
                  series: event.seriesId,
                  scope: change.scope === 'following' ? 'all' : change.scope,
                });
              }
              if (event.id !== found.id) onMoved(event.id);
            },
            onError: (error) => ui.notify(error.message, 'danger'),
          },
        )
      }
    />
  );
}

/** An event already loaded for a view, else fetched alone; `null`: it is gone. */
function useEventById(workspaceId: string, id: string): CalendarEvent | null | undefined {
  const [params] = useSearchParams();
  const day = params.get('tag');
  const around = day ? at(day) : new Date();
  const from = midnight(plus(around, -200)).toISOString();
  const to = midnight(plus(around, 200)).toISOString();
  const events = useCalendarEvents(workspaceId, from, to);
  if (!events.data) return undefined;
  return events.data.find((each) => each.id === id) ?? null;
}

function NewEventForm({
  draft,
  calendars,
  onClose,
  onCreated,
}: {
  draft: NewEvent;
  calendars: Calendar[];
  onClose: () => void;
  onCreated: (event: CalendarEvent) => void;
}) {
  const ui = useCloud();
  const create = useCreateEvent(ui.workspace.id);
  const source = useCalendarSource(calendars);
  const editable = calendars.filter((each) => each.canEdit);
  const last = readString(lastCalendarKey(ui.workspace.id));
  // A meeting goes to an area's calendar (its call is the area's): the last one picked if it is
  // one, else the workspace's own; a plain event to the last one, else one's private one.
  const areaCalendars = editable.filter((each) => each.kind === 'area' && !each.parentId);
  const calendarId =
    (draft.meeting
      ? (
          areaCalendars.find((each) => each.id === last) ??
          areaCalendars.find((each) => each.areaId === ui.home?.areas.find(isWorkspaceOwn)?.id) ??
          areaCalendars[0]
        )?.id
      : undefined) ??
    // In one source atop the page (`?quelle=`), one of its calendars: it stays in sight.
    (plainEventCalendar(
      source ? calendars.filter((each) => sourceOf(each) === source) : calendars,
      ui.workspace.id,
    ) ||
      plainEventCalendar(calendars, ui.workspace.id));
  const startMinutes =
    draft.minutes ?? (draft.meeting ? Math.min(23, new Date().getHours() + 1) * 60 : 9 * 60);
  const [fields, setFields] = useState<Fields>({
    calendarId,
    title: '',
    location: '',
    notes: '',
    allDay: draft.minutes === undefined && !draft.meeting,
    startDay: draft.day,
    startTime: hhmm(startMinutes),
    endDay: startMinutes + 60 >= 24 * 60 ? iso(plus(at(draft.day), 1)) : draft.day,
    endTime: hhmm(startMinutes + 60),
    meeting: null,
    repeat: null,
  });
  // „Neues Meeting“: the call in its calendar's area, once Sender's conversations are in – and
  // along with the calendar while it is still the one set by itself.
  const places = useCallPlaces(ui.workspace.id, draft.meeting === true);
  const areaCall = (id: string): EventMeeting | null => {
    const areaId = editable.find((each) => each.id === id)?.areaId;
    const channel = places.areas.find(
      (each) => each.area.id === areaId && each.channel.kind === 'area',
    )?.channel;
    return channel ? { kind: 'call', channelId: channel.id } : null;
  };
  const [presetFor, setPresetFor] = useState<string | null>(null);
  // Its meeting picked by hand („Kein Meeting“ too): no area's call comes back with a calendar.
  const [picked, setPicked] = useState(false);
  const preset = draft.meeting && !picked ? areaCall(fields.calendarId) : null;
  if (draft.meeting && preset && !fields.meeting && presetFor !== fields.calendarId) {
    setPresetFor(fields.calendarId);
    setFields({ ...fields, meeting: preset });
  }
  const onFields = (next: Fields) => {
    const byHand = picked || JSON.stringify(next.meeting) !== JSON.stringify(fields.meeting);
    if (byHand) setPicked(true);
    const followed =
      draft.meeting &&
      !byHand &&
      next.calendarId !== fields.calendarId &&
      JSON.stringify(fields.meeting) === JSON.stringify(areaCall(fields.calendarId));
    setFields(followed ? { ...next, meeting: areaCall(next.calendarId) } : next);
  };
  // Files pasted into the notes or picked with the clip go on it when it is put in – not on a
  // mail calendar's (those live at the provider).
  const mailCalendar = !!editable.find((each) => each.id === fields.calendarId)?.mailAccountId;
  const attach = useAttachments({
    workspaceId: mailCalendar ? null : ui.workspace.id,
    onError: (message) => ui.notify(message, 'danger'),
  });
  const put = () => {
    const when = timing(fields);
    const title = fields.title.trim();
    if (!title) return ui.notify('Der Termin braucht einen Titel.', 'danger');
    if (!when) return ui.notify('Der Termin endet vor seinem Beginn.', 'danger');
    if (attach.busy) return ui.notify('Die Dateien laden noch hoch.', 'danger');
    writeString(lastCalendarKey(ui.workspace.id), fields.calendarId);
    create.mutate(
      {
        calendarId: fields.calendarId,
        title,
        location: fields.location.trim(),
        notes: fields.notes,
        ...(fields.meeting && { meeting: fields.meeting }),
        ...(attach.enabled && attach.ids.length > 0 && { attachments: attach.ids }),
        ...(fields.repeat && !mailCalendar && { repeat: fields.repeat, timeZone: ownZone() }),
        ...when,
      },
      {
        onSuccess: onCreated,
        onError: (error) => ui.notify(error.message, 'danger'),
      },
    );
  };
  if (!editable.length) {
    return (
      <Shell title="Neuer Termin" onClose={onClose}>
        <p className="text-sm text-fg-muted">Du darfst in keinen Kalender etwas eintragen.</p>
      </Shell>
    );
  }
  return (
    <Shell title={draft.meeting ? 'Neues Meeting' : 'Neuer Termin'} onClose={onClose}>
      <Fields
        fields={fields}
        calendars={editable}
        canEdit
        autoFocus
        onFields={onFields}
        onSubmit={put}
        onPaste={attach.onPaste}
        files={
          attach.enabled && (
            <>
              <AttachmentChips files={attach} />
              <div className="-ml-1.5 flex">
                <AttachButton files={attach} />
              </div>
            </>
          )
        }
      />
      <Button icon="add" onClick={put} className="self-start">
        {draft.meeting ? 'Meeting anlegen' : 'Termin anlegen'}
      </Button>
    </Shell>
  );
}

function EventForm({
  event,
  calendars,
  scope,
  onClose,
  onChange: send,
}: {
  event: CalendarEvent;
  calendars: Calendar[];
  /** One of a series: which of it a change means, once asked. */
  scope: EventScope | null;
  onClose: () => void;
  onChange: (change: CalendarEventChange, files?: Attachment[]) => void;
}) {
  const ui = useCloud();
  const remove = useDeleteEvent(ui.workspace.id);
  const [deleting, setDeleting] = useState(false);
  // One of a series changed: which of it, asked before it is sent (files are the series').
  const [asking, setAsking] = useState<CalendarEventChange | null>(null);
  const onChange = (change: CalendarEventChange, files?: Attachment[]) => {
    if (!event.seriesId) return send(change, files);
    if (scope && !(scope === 'one' && change.repeat !== undefined)) {
      return send({ ...change, scope });
    }
    setAsking(change);
  };
  const [fields, setFields] = useState(() => fieldsOf(event));
  // Changed elsewhere (live, in another tab): the fields follow.
  const [seen, setSeen] = useState(event);
  if (seen !== event) {
    setSeen(event);
    setFields(fieldsOf(event));
  }
  const calendar = calendars.find((each) => each.id === event.calendarId);
  const editable = calendars.filter((each) => each.canEdit);
  // Files pasted into the notes or picked with the clip: up, they are on it at once. A mail
  // calendar's events live at the provider – no files there.
  const [deletingFile, setDeletingFile] = useState<Attachment | null>(null);
  const attach = useAttachments({
    workspaceId: event.canEdit && !calendar?.mailAccountId ? ui.workspace.id : null,
    onError: (message) => ui.notify(message, 'danger'),
  });
  // Files are the series' – never asked which of it.
  const setFiles = (files: Attachment[]) =>
    send(
      {
        attachments: files.map((one) => one.id),
        ...(event.seriesId && { scope: 'all' as const }),
      },
      files,
    );
  const upCount = attach.busy ? 0 : attach.ready.length;
  useEffect(() => {
    if (upCount === 0) return;
    const files = [...(event.attachments ?? []), ...attach.ready];
    attach.clear();
    setFiles(files);
    // Only once all are up; `event` is the one shown now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upCount]);
  /** Keeps what changed: text on leaving its field, the rest at once. */
  const keep = (next: Fields) => {
    setFields(next);
    const change: CalendarEventChange = {};
    const before = fieldsOf(event);
    if (next.calendarId !== before.calendarId) change.calendarId = next.calendarId;
    if (next.title.trim() && next.title.trim() !== event.title) change.title = next.title.trim();
    if (next.location.trim() !== event.location) change.location = next.location.trim();
    if (next.notes !== event.notes) change.notes = next.notes;
    if (JSON.stringify(next.meeting) !== JSON.stringify(before.meeting)) {
      change.meeting = next.meeting;
    }
    if (JSON.stringify(next.repeat) !== JSON.stringify(before.repeat)) {
      change.repeat = next.repeat;
      if (next.repeat) change.timeZone = ownZone();
    }
    const when = timing(next);
    const was = timing(before);
    if (when && JSON.stringify(when) !== JSON.stringify(was)) Object.assign(change, when);
    if (!when && JSON.stringify(next) !== JSON.stringify(before)) {
      ui.notify('Der Termin endet vor seinem Beginn.', 'danger');
      setFields(before);
      return;
    }
    if (Object.keys(change).length) onChange(change);
  };
  return (
    <Shell
      title={calendar?.name ?? 'Termin'}
      color={calendar ? colorOf(calendar.color) : undefined}
      onClose={onClose}
      menu={
        event.canEdit && (
          <Menu
            label="Mehr zum Termin"
            actions={[
              {
                label: 'Löschen',
                icon: 'delete',
                tone: 'danger',
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        )
      }
    >
      <Fields
        fields={fields}
        calendars={editable.length ? editable : calendar ? [calendar] : []}
        canEdit={event.canEdit}
        onFields={setFields}
        onKeep={keep}
        onPaste={attach.onPaste}
        files={
          (event.attachments?.length || attach.enabled) && (
            <>
              <SentAttachments
                attachments={event.attachments}
                onDelete={attach.enabled ? setDeletingFile : undefined}
              />
              <AttachmentChips files={attach} />
              {attach.enabled && (
                <div className="-ml-1.5 flex">
                  <AttachButton files={attach} />
                </div>
              )}
            </>
          )
        }
      />
      {deletingFile && (
        <ConfirmDialog
          title={`„${deletingFile.name}“ löschen?`}
          description="Die Datei geht vom Termin und wird gelöscht."
          confirmLabel="Löschen"
          onClose={() => setDeletingFile(null)}
          onConfirm={() => {
            const gone = deletingFile;
            setDeletingFile(null);
            setFiles((event.attachments ?? []).filter((one) => one.id !== gone.id));
            ui.notify(`„${gone.name}“ gelöscht`);
          }}
        />
      )}
      {event.createdBy && (
        <p className="text-xs text-fg-faint">
          Angelegt von {event.createdBy.id === ui.userId ? 'dir' : event.createdBy.name}
        </p>
      )}
      {asking && (
        <ScopeDialog
          title={event.title}
          deleting={false}
          wholeOnly={asking.repeat !== undefined}
          onClose={() => {
            setAsking(null);
            setFields(fieldsOf(event));
          }}
          onPick={(picked) => {
            setAsking(null);
            send({ ...asking, scope: picked });
          }}
        />
      )}
      {deleting && event.seriesId && (
        <ScopeDialog
          title={event.title}
          deleting
          wholeOnly={false}
          onClose={() => setDeleting(false)}
          onPick={(picked) => {
            setDeleting(false);
            onClose();
            remove.mutateAsync({ event, scope: picked }).then(
              () => ui.notify(`„${event.title}“ gelöscht`),
              (error: Error) => ui.notify(error.message, 'danger'),
            );
          }}
        />
      )}
      {deleting && !event.seriesId && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title={`„${event.title}“ löschen?`}
          description="Der Termin ist dann für alle weg."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            setDeleting(false);
            onClose();
            remove.mutateAsync({ event }).then(
              () => ui.notify(`„${event.title}“ gelöscht`),
              (error: Error) => ui.notify(error.message, 'danger'),
            );
          }}
        />
      )}
    </Shell>
  );
}

function Shell({
  title,
  color,
  menu,
  closeLabel = 'Termin schließen (Esc)',
  onClose,
  children,
}: {
  title: string;
  color?: string;
  menu?: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline py-2.5 pr-2.5 pl-5">
        {color && (
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{title}</span>
        {menu}
        <IconButton icon="close" label={closeLabel} size="sm" onClick={onClose} />
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
        onKeyDown={(event) => {
          // Esc in a field keeps what was typed (its blur saves) and closes the panel.
          if (event.key === 'Escape' && isTextTarget(event.target)) {
            event.stopPropagation();
            (event.target as HTMLElement).blur();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </>
  );
}

const dayLabel = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function Fields({
  fields,
  calendars,
  canEdit,
  autoFocus = false,
  onFields,
  onKeep = onFields,
  onSubmit,
  onPaste,
  files,
}: {
  fields: Fields;
  calendars: Calendar[];
  canEdit: boolean;
  autoFocus?: boolean;
  /** As typed. */
  onFields: (fields: Fields) => void;
  /** To be kept (a field left, a pick). */
  onKeep?: (fields: Fields) => void;
  /** Enter in the title: a new one is put in. */
  onSubmit?: () => void;
  /** Files pasted into the notes. */
  onPaste?: ((event: ClipboardEvent<HTMLTextAreaElement>) => void) | undefined;
  /** Under the notes: its files and the clip. */
  files?: ReactNode;
}) {
  const set = (change: Partial<Fields>) => onKeep({ ...fields, ...change });
  // The panel takes the focus as it opens (`SidePanel`); a new one's title takes it after.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  return (
    <>
      <AutosizeTextarea
        value={fields.title}
        ref={titleRef}
        readOnly={!canEdit}
        onChange={(event) =>
          onFields({ ...fields, title: event.target.value.replace(/\s*\n\s*/g, ' ') })
        }
        onBlur={() => onKeep(fields)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (onSubmit) onSubmit();
          else event.currentTarget.blur();
        }}
        maxLength={300}
        maxHeight={Infinity}
        placeholder="Titel"
        aria-label="Titel"
        className="text-lg leading-snug font-semibold text-fg placeholder:text-fg-faint"
      />
      <div className="flex flex-col gap-2">
        <Toggle
          checked={fields.allDay}
          onChange={(allDay) => set({ allDay })}
          label="Ganztägig"
          size="sm"
          disabled={!canEdit}
        />
        <When
          label="Beginn"
          day={fields.startDay}
          time={fields.allDay ? null : fields.startTime}
          disabled={!canEdit}
          onDay={(startDay) => {
            // The end moves along, as every calendar's: the length stays.
            const shift = Math.round(
              (at(startDay).getTime() - at(fields.startDay).getTime()) / 86_400_000,
            );
            set({ startDay, endDay: iso(plus(at(fields.endDay), shift)) });
          }}
          onTime={(startTime) => {
            const length =
              instant(fields.endDay, fields.endTime).getTime() -
              instant(fields.startDay, fields.startTime).getTime();
            const end = new Date(
              instant(fields.startDay, startTime).getTime() + Math.max(length, 15 * 60_000),
            );
            set({ startTime, endDay: iso(end), endTime: clock(end) });
          }}
        />
        <When
          label="Ende"
          day={fields.endDay}
          time={fields.allDay ? null : fields.endTime}
          disabled={!canEdit}
          onDay={(endDay) => set({ endDay })}
          onTime={(endTime) => set({ endTime })}
        />
      </div>
      {/* A mailbox's calendar repeats at its provider: not set here. */}
      {!calendars.find((each) => each.id === fields.calendarId)?.mailAccountId &&
        (canEdit || fields.repeat) && (
          <RepeatField
            repeat={fields.repeat}
            firstDay={fields.startDay}
            disabled={!canEdit}
            onChange={(repeat) => set({ repeat })}
          />
        )}
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Icon name="calendar" size="sm" className="shrink-0 text-fg-subtle" />
        <CalendarPicker
          value={fields.calendarId}
          calendars={calendars}
          disabled={!canEdit || calendars.length < 2}
          onPick={(calendarId) => set({ calendarId })}
        />
      </div>
      <MeetingField
        meeting={fields.meeting}
        canEdit={canEdit}
        callsAllowed={!calendars.find((each) => each.id === fields.calendarId)?.mailAccountId}
        onChange={(meeting) => set({ meeting })}
      />
      <div className="flex items-start gap-2">
        <Icon name="location" size="sm" className="mt-0.5 shrink-0 text-fg-subtle" />
        <AutosizeTextarea
          value={fields.location}
          readOnly={!canEdit}
          onChange={(event) =>
            onFields({ ...fields, location: event.target.value.replace(/\n/g, ' ') })
          }
          onBlur={() => {
            // A meeting's link typed or pasted as the place becomes the meeting (not over a call).
            const found = fields.meeting?.kind === 'call' ? null : meetingLinkIn(fields.location);
            onKeep(
              found
                ? { ...fields, location: found.rest, meeting: { kind: 'link', url: found.url } }
                : fields,
            );
          }}
          maxLength={500}
          maxHeight={120}
          placeholder={canEdit ? 'Ort oder Link hinzufügen' : 'Kein Ort'}
          aria-label="Ort"
          className="flex-1 resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
      <AutosizeTextarea
        value={fields.notes}
        readOnly={!canEdit}
        onChange={(event) => onFields({ ...fields, notes: event.target.value })}
        onBlur={() => onKeep(fields)}
        onPaste={onPaste}
        maxHeight={480}
        placeholder={canEdit ? 'Notizen hinzufügen …' : 'Keine Notizen'}
        aria-label="Notizen"
        className="resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
      />
      {files && <div className="-mt-2 flex flex-col gap-1.5">{files}</div>}
    </>
  );
}

/** A day (a month to pick from) and, not all-day, a time typed as one says it („930“). */
function When({
  label,
  day,
  time,
  disabled,
  onDay,
  onTime,
}: {
  label: string;
  day: string;
  time: string | null;
  disabled: boolean;
  onDay: (day: string) => void;
  onTime: (time: string) => void;
}) {
  const [typed, setTyped] = useState(time ?? '');
  const [seen, setSeen] = useState(time);
  if (seen !== time) {
    setSeen(time);
    setTyped(time ?? '');
  }
  const leave = () => {
    const parsed = parseTime(typed);
    if (parsed && parsed !== time) onTime(parsed);
    else setTyped(time ?? '');
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-sm text-fg-subtle">{label}</span>
      <Picker
        label={`${label}: Tag`}
        calendar
        disabled={disabled}
        className="px-2"
        trigger={<span className="text-fg tabular-nums">{dayLabel.format(at(day))}</span>}
      >
        {(close) => (
          <MonthGrid
            value={day}
            onPick={(next) => {
              close();
              onDay(next);
            }}
          />
        )}
      </Picker>
      {time !== null && (
        <input
          value={typed}
          disabled={disabled}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={leave}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          inputMode="numeric"
          aria-label={`${label}: Uhrzeit`}
          className={cn(
            'h-7 w-16 rounded-control-sm bg-transparent px-2 text-sm text-fg tabular-nums outline-none hover:bg-hover focus:bg-hover',
          )}
        />
      )}
    </div>
  );
}
