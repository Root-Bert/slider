import { use, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { cloudFileType, type CloudAgentSummary, type CloudNode, type Deck } from '@slider/shared';
import { SummaryBody, UnreadRow, useUnreadNow, type FileSummaryPart } from '@/features/sender';
import { canCreateDecks } from '@/features/workspaces';
import {
  useCloudActivity,
  useCloudAgents,
  useCloudList,
  useCloudSummary,
  useDecks,
  useOrderCloudAgent,
  type CloudPlace,
} from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { lastVisitsStore, openedIn } from '@/lib/last-visits';
import { routes } from '@/lib/routes';
import { Button, cn, Icon, LogoMark, RowList, Spinner, TextLink } from '@/ui';
import { ActivityFeed } from '../components/ActivityFeed';
import { AgentAvatar } from '../components/AgentAvatar';
import { AgentComposer } from '../components/AgentComposer';
import { areaColor } from '../components/AreaDot';
import { Empty, LoadFailed } from '../components/Empty';
import {
  FileBrowser,
  FileBrowserSkeleton,
  FilePicture,
  fileClicks,
} from '../components/FileBrowser';
import { FileIcon } from '../components/FileIcon';
import { FileName } from '../components/FileName';
import { ForYou } from '../components/ForYou';
import { StorageBar, storageParts, usedText } from '../components/StorageMeter';
import { MyTodos } from '../components/todos/TodoList';
import { UpcomingEvents } from '../components/calendar/UpcomingEvents';
import { useCloud } from '../hooks/useCloud';
import { useLastVisit } from '../lib/last-visit';
import { FrameContext, Nothing, SHARED_INFO, SHARED_VIEWS, useHomePage, WidgetHead } from './frame';
import type { BoardKit, WidgetInfo } from './kit';
import { CLOUD_BOARD, type Widget, type WidgetType } from './layout';

export const WIDGET_INFO: Record<WidgetType, WidgetInfo> = {
  today: SHARED_INFO.today,
  order: {
    label: 'Auftrag',
    icon: 'send',
    about: 'Was soll erledigt werden? Daraus wird ein Agent. Ohne Übersicht dazu.',
  },
  forYou: {
    label: 'Für dich',
    icon: 'autoAwesome',
    about: 'Der Auftrag, darunter, was gerade auf dich wartet, von der KI gesagt',
  },
  continue: {
    label: 'Weiterarbeiten',
    icon: 'history',
    about: 'Dateien, Präsentationen und Agenten von zuletzt',
  },
  since: {
    label: 'Seit deinem letzten Besuch',
    icon: 'notifications',
    about: 'Was neu ist, von der KI zusammengefasst',
  },
  unread: {
    label: 'Ungelesen',
    icon: 'markEmailUnread',
    about: 'Chats, Agenten und Mails, die auf dich warten',
  },
  todos: { label: 'Deine Aufgaben', icon: 'checklist', about: 'Deine dringendsten Aufgaben' },
  events: {
    label: 'Anstehende Termine',
    icon: 'event',
    about: 'Die nächsten Termine deiner Kalender',
  },
  changed: {
    label: 'Zuletzt geändert',
    icon: 'insertDriveFile',
    about: 'Die Dateien, die sich zuletzt geändert haben',
  },
  activity: { label: 'Aktivität', icon: 'timeline', about: 'Was mit den Dateien passiert ist' },
  agents: { label: 'Agenten', icon: 'desk', about: 'Deine Agenten und woran sie arbeiten' },
  decks: {
    label: 'Präsentationen',
    icon: 'slideshow',
    about: 'Die Präsentationen, die du zuletzt geöffnet hast',
  },
  pins: { label: 'Angeheftet', icon: 'pushPin', about: 'Deine angehefteten Ordner' },
  storage: { label: 'Speicher', icon: 'storage', about: 'Wie viel Platz der Workspace belegt' },
  note: SHARED_INFO.note,
};

/** The listing „Zuletzt“'s files and cards come from – one query for both widgets. */
export const RECENT: CloudPlace = { scope: 'recent' };

/* ---------- Auftrag ---------- */

/** As on „Agenten“: the order becomes an agent of one's own, opened at once. */
function OrderWidget() {
  const ui = useCloud();
  const { workspace } = ui;
  const order = useOrderCloudAgent(workspace.id);
  const navigate = useNavigate();
  return (
    <>
      <WidgetHead />
      <AgentComposer
        top
        placeholder="Was soll erledigt werden?"
        keep={{
          key: draftKeys.newAgent(workspace.id),
          target: { kind: 'agent-new', workspaceId: workspace.id },
        }}
        busy={order.isPending}
        workspaceId={workspace.id}
        onSend={(text, attachments) =>
          order.mutateAsync({ text, attachments }).then(
            (agent) => {
              void navigate(routes.cloudAgent(workspace.id, agent.id));
              return true;
            },
            (error: Error) => {
              ui.notify(error.message, 'danger');
              return false;
            },
          )
        }
      />
    </>
  );
}

/* ---------- Für dich ---------- */

function ForYouWidget() {
  // As Sender's „Aktuell“: asked anew when something comes in or is read.
  const unreadNow = useUnreadNow();
  return (
    <>
      <WidgetHead />
      <ForYou stamp={unreadNow.stamp} />
    </>
  );
}

/* ---------- Weiterarbeiten ---------- */

type Work =
  | { at: string; file: CloudNode }
  | { at: string; deck: Deck }
  | { at: string; agent: CloudAgentSummary };

const workKey = (work: Work) =>
  'agent' in work ? work.agent.id : 'deck' in work ? work.deck.id : work.file.id;

/** One thing to go on with: a file, a presentation from Slider or an agent – its picture, its name. */
function WorkCard({ work }: { work: Work }) {
  const ui = useCloud();
  const card = 'group flex min-w-0 flex-col gap-2.5 outline-none';
  const frame =
    'relative aspect-[5/3] overflow-hidden rounded-panel bg-surface-1 ring-hairline transition-colors group-hover:bg-surface-2 group-focus-visible:ring-2 group-focus-visible:ring-focus';
  if ('agent' in work) {
    const { agent } = work;
    return (
      <Link to={routes.cloudAgent(ui.workspace.id, agent.id)} className={card}>
        <span className={frame}>
          <span className="flex size-full items-center justify-center">
            <AgentAvatar id={agent.id} size={56} className="shadow-float" />
          </span>
        </span>
        <span className="flex min-w-0 items-start gap-2.5 px-0.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <AgentAvatar id={agent.id} size={18} className="rounded-[5px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body font-medium text-fg">{agent.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
              <span className="truncate">
                Agent | {agent.running ? 'Arbeitet' : formatRelativeTime(work.at)}
              </span>
              {agent.running && (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
              )}
            </span>
          </span>
        </span>
      </Link>
    );
  }
  if ('deck' in work) {
    const { deck } = work;
    return (
      <Link to={routes.deck(deck.id)} className={card}>
        <span className={frame}>
          {deck.thumbnailUrl ? (
            <img
              src={deck.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 m-auto max-h-[78%] max-w-[78%] rounded-thumb shadow-float"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <LogoMark width={40} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-start gap-2.5 px-0.5">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <LogoMark width={16} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body font-medium text-fg">{deck.title}</span>
            <span className="truncate text-xs text-fg-muted">
              Präsentation | {formatRelativeTime(work.at)}
            </span>
          </span>
        </span>
      </Link>
    );
  }
  const { file } = work;
  return (
    <Link
      to={ui.hrefOf(file)}
      className={card}
      // As the file's row in a list: its details at a click, opened at a double click or Enter.
      {...fileClicks(ui, file)}
    >
      <span className={frame}>
        <FilePicture node={file} />
      </span>
      <span className="flex min-w-0 items-start gap-2.5 px-0.5">
        <FileIcon kind="file" type={file.fileType} size={20} className="mt-0.5" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <FileName node={file} className="text-body font-medium text-fg" />
          <span className="truncate text-xs text-fg-muted">
            {file.updatedBy.id === ui.userId ? 'Du' : file.updatedBy.name} |{' '}
            {formatRelativeTime(file.updatedAt)}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** The narrowest a card of „Weiterarbeiten“ and „Präsentationen“ gets – as many as fit side by side. */
const CARD_MIN_PX = 200;
const DECK_MIN_PX = 168;
const CARD_GAP_PX = 16;

/**
 * How many cards of at least `min` px stand side by side in the element – as wide as it is on the
 * page (while arranging it is narrower by the panel; counted anew, cards would go and come back).
 */
function useColumns(min: number) {
  const { widen } = use(FrameContext)!;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(3);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () =>
      setColumns(
        Math.max(1, Math.floor((element.clientWidth + widen + CARD_GAP_PX) / (min + CARD_GAP_PX))),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, min, widen]);
  return [setElement, columns] as const;
}

/** How many cards „Weiterarbeiten“ takes in – as many as a large widget shows. */
const WORK_MAX = 8;

/** What one opened counts as much as what changed (files, presentations, agents alike). */
function useWork(): Work[] {
  const ui = useCloud();
  const { workspace } = ui;
  const listing = useCloudList(workspace.id, RECENT);
  const decks = useDecks(workspace.id);
  const agents = useCloudAgents(workspace.id);
  // A presentation's file is the presentation: shown once, as that.
  const standIns = new Set((decks.data ?? []).map((deck) => deck.cloudNodeId));
  // A file by when the server says (changed or opened, as it sorts them), a presentation also by
  // when this browser last showed it.
  const opened = openedIn(
    useSyncExternalStore(lastVisitsStore.subscribe, lastVisitsStore.getSnapshot),
    ui.userId,
  );
  const latest = (iso: string, ms: number | undefined) =>
    ms !== undefined && ms > Date.parse(iso) ? new Date(ms).toISOString() : iso;
  return [
    ...(listing.data?.nodes ?? [])
      .filter((file) => !standIns.has(file.id))
      .slice(0, WORK_MAX)
      .map((file) => ({ at: file.recentAt ?? file.updatedAt, file })),
    ...(decks.data ?? [])
      .filter((deck) => !deck.archivedAt)
      .map((deck) => ({ at: latest(deck.updatedAt, opened[deck.id]), deck })),
    ...(agents.data ?? []).map((agent) => ({ at: agent.updatedAt, agent })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, WORK_MAX);
}

/**
 * Cards in a row, as many as the widget is wide – as high as its content: one row, never one
 * left alone below; given a height, more rows that scroll.
 */
function ContinueWidget() {
  const work = useWork();
  const frame = use(FrameContext)!;
  const [ref, columns] = useColumns(CARD_MIN_PX);
  const shown = frame.widget.h === 'auto' ? work.slice(0, columns) : work;
  return (
    <>
      <WidgetHead />
      {work.length === 0 ? (
        <Nothing>Sobald du etwas öffnest, steht es hier.</Nothing>
      ) : (
        <div
          ref={ref}
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shown.map((each) => (
            <WorkCard key={workKey(each)} work={each} />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Seit deinem letzten Besuch ---------- */

/** A file's part of „Seit deinem letzten Besuch“: its mark, its name – opened while still there. */
function FilePart({ part }: { part: FileSummaryPart }) {
  const ui = useCloud();
  const { id, nodeKind } = part;
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center text-fg-muted">
        {nodeKind ? (
          <FileIcon
            kind={nodeKind}
            type={nodeKind === 'file' ? cloudFileType(part.name) : null}
            size={20}
          />
        ) : (
          <Icon name="cloud" size={16} />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {id && nodeKind ? (
          <button
            type="button"
            className="flex min-w-0 text-left text-body font-medium text-fg hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={() =>
              nodeKind === 'folder' ? ui.open({ id, kind: 'folder' } as never) : ui.openFile(id)
            }
          >
            <FileName node={{ name: part.name, kind: nodeKind }} />
          </button>
        ) : (
          <FileName
            node={{ name: part.name, kind: nodeKind ?? 'other' }}
            className="text-body font-medium text-fg"
          />
        )}
        <span className="text-body text-fg-muted">{part.text}</span>
      </span>
    </>
  );
}

function SinceWidget() {
  const ui = useCloud();
  const { workspace } = ui;
  const unreadNow = useUnreadNow();
  const activity = useCloudActivity(workspace.id, null);
  // Asked anew when something comes in, is read, or others did something with the files (one's
  // own doings are no news to oneself).
  const since = useLastVisit(ui.userId, workspace.id);
  const othersLast = activity.data?.find((event) => event.actor.id !== ui.userId);
  const summary = useCloudSummary(
    workspace.id,
    since,
    unreadNow.stamp === null || !activity.data
      ? null
      : `${unreadNow.stamp}|${othersLast ? `${othersLast.id}:${othersLast.more}` : ''}`,
  );
  return (
    <>
      <WidgetHead
        action={summary.isFetching && <Spinner size={16} label="Die KI fasst zusammen" />}
      />
      <div className="flex min-h-0 flex-col gap-2">
        <SummaryBody
          summary={summary.data}
          pending={summary.isPending}
          error={summary.isError && !summary.data ? summary.error.message : null}
          onRetry={() => void summary.refetch()}
          filePart={(part) => <FilePart part={part} />}
          sinceLabel="Neu seit"
        />
      </div>
    </>
  );
}

/* ---------- Ungelesen ---------- */

/** How many unread conversations the widget shows when as high as its content. */
const UNREAD_SHOWN = 5;

function UnreadWidget() {
  const unreadNow = useUnreadNow();
  const frame = use(FrameContext)!;
  const all = unreadNow.unread.data?.items ?? [];
  const unread = frame.widget.h === 'auto' ? all.slice(0, UNREAD_SHOWN) : all;
  return (
    <>
      <WidgetHead />
      {unread.length === 0 ? (
        <Nothing>Alles gelesen.</Nothing>
      ) : (
        <RowList variant="hover" aria-label="Ungelesen">
          {unread.map((item) => (
            <UnreadRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </RowList>
      )}
    </>
  );
}

/* ---------- Aufgaben, Termine ---------- */

/** Given a height, as many as it holds – they scroll. */
const shownIn = (widget: Widget) => (widget.h === 'auto' ? 5 : 50);

function TodosWidget() {
  const frame = use(FrameContext)!;
  return (
    <MyTodos
      shown={shownIn(frame.widget)}
      head={(link) => <WidgetHead action={link} />}
      empty={<Nothing>Keine offenen Aufgaben.</Nothing>}
    />
  );
}

function EventsWidget() {
  const frame = use(FrameContext)!;
  return (
    <UpcomingEvents
      shown={shownIn(frame.widget)}
      head={(link) => <WidgetHead action={link} />}
      empty={<Nothing>Keine Termine in den nächsten zwei Wochen.</Nothing>}
    />
  );
}

/* ---------- Zuletzt geändert ---------- */

function ChangedWidget() {
  const ui = useCloud();
  const selection = useHomePage().selection!;
  const listing = useCloudList(ui.workspace.id, RECENT);
  const nodes = listing.data?.nodes ?? [];
  const target = { name: 'Meine Dateien' };
  return (
    <>
      <WidgetHead
        action={
          ui.home?.ownFiles !== false && (
            <TextLink to={routes.cloudOwn(ui.workspace.id)} size="body">
              Meine Dateien
            </TextLink>
          )
        }
      />
      {listing.isPending ? (
        <FileBrowserSkeleton view="list" />
      ) : listing.isLoadingError ? (
        <LoadFailed message={listing.error.message} onRetry={() => void listing.refetch()} />
      ) : nodes.length === 0 ? (
        <Empty
          inline
          icon="cloud"
          title="Noch keine Dateien"
          message="Zieh Dateien oder ganze Ordner hierher, sie landen in „Meine Dateien“."
          action={
            <Button variant="primary" icon="upload" onClick={() => ui.pickAndUpload(target)}>
              Dateien hochladen
            </Button>
          }
        />
      ) : (
        <FileBrowser nodes={nodes} mode="across" view="list" selection={selection} />
      )}
    </>
  );
}

/* ---------- Aktivität ---------- */

function ActivityWidget() {
  const ui = useCloud();
  const activity = useCloudActivity(ui.workspace.id, null);
  return (
    <>
      <WidgetHead />
      <ActivityFeed events={(activity.data ?? []).slice(0, 30)} compact />
    </>
  );
}

/* ---------- Agenten ---------- */

function AgentsWidget() {
  const ui = useCloud();
  const agents = useCloudAgents(ui.workspace.id);
  const frame = use(FrameContext)!;
  // Those at work first, then by when they last did something.
  const list = [...(agents.data ?? [])]
    .sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, frame.widget.h === 'auto' ? 5 : 50);
  return (
    <>
      <WidgetHead
        action={
          <TextLink to={routes.cloudAgents(ui.workspace.id)} size="body">
            Alle Agenten
          </TextLink>
        }
      />
      {list.length === 0 ? (
        <Nothing>Noch keine Agenten. Gib einen Auftrag, daraus wird einer.</Nothing>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {list.map((agent) => (
            <li key={agent.id}>
              <Link
                to={routes.cloudAgent(ui.workspace.id, agent.id)}
                className="flex min-w-0 items-center gap-3 rounded-control px-2 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
              >
                <AgentAvatar id={agent.id} size={28} className="shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium text-fg">{agent.title}</span>
                  <span className="truncate text-xs text-fg-muted">
                    {agent.running
                      ? 'Arbeitet'
                      : (agent.summary ?? formatRelativeTime(agent.updatedAt))}
                  </span>
                </span>
                {agent.running ? (
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
                ) : (
                  agent.openFiles > 0 && (
                    <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                      {agent.openFiles === 1 ? '1 Datei' : `${agent.openFiles} Dateien`}
                    </span>
                  )
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------- Präsentationen ---------- */

function DecksWidget() {
  const ui = useCloud();
  const decks = useDecks(ui.workspace.id);
  const frame = use(FrameContext)!;
  const opened = openedIn(
    useSyncExternalStore(lastVisitsStore.subscribe, lastVisitsStore.getSnapshot),
    ui.userId,
  );
  const at = (deck: Deck) => Math.max(Date.parse(deck.updatedAt), opened[deck.id] ?? 0);
  const list = (decks.data ?? [])
    .filter((deck) => !deck.archivedAt)
    .sort((a, b) => at(b) - at(a))
    .slice(0, 12);
  const [ref, columns] = useColumns(DECK_MIN_PX);
  const shown = frame.widget.h === 'auto' ? list.slice(0, columns) : list;
  return (
    <>
      <WidgetHead
        action={
          <TextLink to={routes.workspace(ui.workspace.id)} size="body">
            Alle Präsentationen
          </TextLink>
        }
      />
      {list.length === 0 ? (
        <Nothing>Noch keine Präsentationen.</Nothing>
      ) : (
        <div
          ref={ref}
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {shown.map((deck) => (
            <WorkCard key={deck.id} work={{ deck, at: new Date(at(deck)).toISOString() }} />
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Angeheftet ---------- */

function PinsWidget() {
  const ui = useCloud();
  const pins = ui.home?.pins ?? [];
  return (
    <>
      <WidgetHead />
      {pins.length === 0 ? (
        <Nothing>Hefte Ordner an, sie stehen dann hier.</Nothing>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {pins.map((pin) => (
            <li key={pin.id}>
              <Link
                to={routes.cloudFolder(ui.workspace.id, pin.id)}
                className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-body text-fg outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
              >
                <Icon
                  name="folder"
                  size={18}
                  className="shrink-0 text-fg-muted"
                  style={pin.color ? { color: areaColor(pin.color) } : undefined}
                />
                <span className="min-w-0 truncate">{pin.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------- Speicher ---------- */

function StorageWidget() {
  const ui = useCloud();
  const storage = ui.home?.storage;
  if (!storage) return <WidgetHead />;
  const full = storage.maxBytes !== null && storage.usedBytes >= storage.maxBytes * 0.95;
  const parts = storageParts(storage).filter((part) => part.bytes > 0);
  return (
    <>
      <WidgetHead />
      <div className="flex flex-col gap-2.5">
        <p className={cn('text-sm font-medium tabular-nums', full ? 'text-warning' : 'text-fg')}>
          {usedText(storage)}
        </p>
        <StorageBar storage={storage} />
        {parts.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
            {parts.map((part) => (
              <li key={part.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', part.fill)} />
                {part.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ---------- Registry ---------- */

export const WIDGET_VIEWS: Record<WidgetType, () => ReactNode> = {
  today: SHARED_VIEWS.today,
  order: OrderWidget,
  forYou: ForYouWidget,
  continue: ContinueWidget,
  since: SinceWidget,
  unread: UnreadWidget,
  todos: TodosWidget,
  events: EventsWidget,
  changed: ChangedWidget,
  activity: ActivityWidget,
  agents: AgentsWidget,
  decks: DecksWidget,
  pins: PinsWidget,
  storage: StorageWidget,
  note: SHARED_VIEWS.note,
};

export const CLOUD_KIT: BoardKit = { spec: CLOUD_BOARD, info: WIDGET_INFO, views: WIDGET_VIEWS };

/** What may stand on one's page: the order field for members and admins, as the server says. */
export function useAvailable(): (type: string) => boolean {
  const ui = useCloud();
  return (type) => type !== 'order' || canCreateDecks(ui.workspace.role);
}
