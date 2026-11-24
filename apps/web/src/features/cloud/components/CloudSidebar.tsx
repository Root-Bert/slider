import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  cloudAccessAtLeast,
  type CloudArea,
  type CloudNode,
  type CloudPin,
  type SenderAgent,
  type MailThreadSummary,
  type SenderChannel,
} from '@slider/shared';
import { useCreateDocument, useMailThreads, usePinCloudNode, useTodos } from '@/lib/api';
import { routes } from '@/lib/routes';
import { BarHandle } from '@/shell/BarHandle';
import { BarStartLink } from '@/shell/BarStartLink';
import {
  BarSearchField,
  chatsOf,
  isMailChat,
  mailGroupName,
  NEW_MAIL,
  MutedMark,
  PinnedMark,
  pinKindOf,
  ROW_MENU_CLASS,
  unreadMailOf,
  useMuteAction,
  usePinAction,
  useUnreadAction,
  PersonFace,
  useRowMenu,
  withMailChats,
  isNewKind,
  Unread,
  useSenderOrNull,
  useWorkspaceDrafts,
} from '@/features/sender';
import { canCreateDecks } from '@/features/workspaces';
import {
  Button,
  cn,
  ContextMenu,
  Icon,
  IconButton,
  MenuDivider,
  MenuItem,
  PopoverPanel,
  Tooltip,
  usePopover,
  type IconName,
  type MenuAction,
} from '@/ui';
import { OWN_FILES, useCloud, type CloudTarget } from '../hooks/useCloud';
import { areaTree, canHaveAreasUnder, isWorkspaceOwn } from '../lib/areas';
import { useShownEvent } from './calendar/EventPanel';
import { DROP_FAILED, droppedFiles } from '../lib/upload';
import { areaColor } from './AreaDot';
import { AgentFace } from './AgentFace';
import { useDeleteAgentAction } from './AgentActions';
import { AreaMark } from './AreaMark';
import { useBarSearch } from '../hooks/useBarSearch';
import { BarHits } from './BarHits';
import { OPEN_SEARCH_EVENT } from './SearchPalette';
import { StorageMeter, StorageRing, usedText } from './StorageMeter';
import { isMine } from './todos/order';

/**
 * Folded in: the rows are their icons (the names their tooltips). Only where the bar stands
 * beside the page (`lg`) – as the panel that slides over it on narrow screens it keeps its names.
 */
const Folded = createContext(false);
/** What a folded bar leaves out: names, counts, headings. */
const foldedHide = 'lg:hidden';

const rowClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    // The focus ring inside the row, as a menu's item has it: the areas' list scrolls and
    // would cut one drawn around it.
    'flex h-[34px] shrink-0 items-center gap-2.5 rounded-chip px-2.5 text-sm transition-colors focus-visible:-outline-offset-2',
    isActive ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
  );
const foldedRow = 'lg:w-[38px] lg:justify-center lg:px-0';
/** The storage meter's box at the bar's foot: a row's inset, 46px high like the folded ring's. */
const FOOT_BOX = 'h-[46px] px-2.5 py-1.5';

/**
 * A row of the side bar as a place to drop onto: what is dragged inside the page goes to
 * `onNodes`, files from the desktop to `onFiles` (none: the row takes only the former).
 */
export function useRowDrop({
  enabled = true,
  self,
  onNodes,
  onFiles,
}: {
  enabled?: boolean;
  /** The folder the row stands for: it cannot be dropped onto itself. */
  self?: string;
  onNodes: (nodes: readonly CloudNode[]) => void;
  onFiles?: (data: DataTransfer) => void;
}) {
  const ui = useCloud();
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) =>
    enabled &&
    !ui.dragged().some((node) => node.id === self) &&
    (ui.dragged().length > 0 || (!!onFiles && event.dataTransfer.types.includes('Files')));
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = ui.dragged().length > 0 ? 'move' : 'copy';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const nodes = ui.dragged();
        if (nodes.length > 0) {
          ui.setDragged([]);
          onNodes(nodes);
        } else onFiles?.(event.dataTransfer);
      },
    },
  };
}

/** Files dropped from the desktop go up into `target`; what cannot be read is said. */
export function useFilesInto() {
  const ui = useCloud();
  return (data: DataTransfer, target: CloudTarget) => {
    droppedFiles(data).then(
      (files) => ui.upload(files, target),
      () => ui.notify(DROP_FAILED, 'danger'),
    );
  };
}

// Inside the row: the list it stands in scrolls and would cut a frame around it.
const overClass = 'bg-selected text-fg ring-1 ring-focus ring-inset';

function NavRow({
  to,
  icon,
  end,
  count,
  onNodes,
  onFiles,
  children,
}: {
  to: string;
  icon: IconName;
  end?: boolean;
  count?: number;
  /** With it the row is a place to drop what is dragged in the page. */
  onNodes?: (nodes: readonly CloudNode[]) => void;
  onFiles?: (data: DataTransfer) => void;
  children: ReactNode;
}) {
  const drop = useRowDrop({ enabled: !!onNodes, onNodes: onNodes ?? (() => {}), onFiles });
  const folded = use(Folded);
  // „Neu“'s page stands over the page it was opened from (`?neu=`): that one is not where one is.
  const [params] = useSearchParams();
  const away = isNewKind(params.get('neu'));
  // An area's agent or folder lies under its area: „Agenten“ is not where one is then.
  const { barRow } = useCloud();
  const elsewhere = away || (barRow !== null && barRow !== to);
  return (
    <NavLink
      to={to}
      end={end}
      title={folded && typeof children === 'string' ? children : undefined}
      {...(elsewhere ? { 'aria-current': false as const } : {})}
      className={(state) =>
        cn(
          rowClass({ isActive: barRow === to || (state.isActive && !elsewhere) }),
          folded && foldedRow,
          drop.over && overClass,
        )
      }
      {...drop.handlers}
    >
      <Icon name={icon} size={18} />
      <span className={cn('min-w-0 flex-1 truncate', folded && foldedHide)}>{children}</span>
      {count ? (
        <span className={cn('text-xs text-fg-subtle tabular-nums', folded && foldedHide)}>
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

/** A pinned folder: a link to it; a right click lets it go. */
function PinRow({ pin }: { pin: CloudPin }) {
  const ui = useCloud();
  const unpin = usePinCloudNode(ui.workspace.id);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const target = { parentId: pin.id, name: pin.name };
  const filesInto = useFilesInto();
  const drop = useRowDrop({
    self: pin.id,
    onNodes: (nodes) => ui.moveInto(nodes, target),
    onFiles: (data) => filesInto(data, target),
  });
  const folded = use(Folded);
  return (
    <>
      <NavLink
        to={routes.cloudFolder(ui.workspace.id, pin.id)}
        title={folded ? pin.name : undefined}
        className={(state) =>
          cn(rowClass(state), 'h-8', folded && foldedRow, drop.over && overClass)
        }
        {...drop.handlers}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      >
        <Icon
          name="folder"
          size={18}
          style={pin.color ? { color: areaColor(pin.color) } : undefined}
        />
        <span className={cn('min-w-0 flex-1 truncate', folded && foldedHide)}>{pin.name}</span>
      </NavLink>
      {menuAt && (
        <ContextMenu
          label={`Aktionen für den Ordner ${pin.name}`}
          actions={[
            {
              label: 'Lösen',
              icon: 'pushPin',
              onSelect: () =>
                unpin.mutate(
                  { id: pin.id, pinned: false },
                  { onError: (error) => ui.notify(error.message, 'danger') },
                ),
            },
          ]}
          at={menuAt}
          onClose={() => setMenuAt(null)}
        />
      )}
    </>
  );
}

/** An area in the side bar: a link, and a place to drop files and folders onto. */
function AreaRow({
  area,
  depth,
  open,
  onToggle,
}: {
  area: CloudArea;
  depth: number;
  /** Whether the areas under it show; `null`: it has none. */
  open: boolean | null;
  onToggle: () => void;
}) {
  const ui = useCloud();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const editable = cloudAccessAtLeast(area.access, 'edit');
  const manage = area.access === 'manage';
  const folded = use(Folded);
  const target = { areaId: area.id, name: area.name };
  const filesInto = useFilesInto();
  const drop = useRowDrop({
    enabled: editable,
    onNodes: (nodes) => ui.moveInto(nodes, target),
    onFiles: (data) => filesInto(data, target),
  });
  const actions: MenuAction[] = [
    ...(editable
      ? [
          {
            label: 'Dateien hochladen …',
            icon: 'upload',
            onSelect: () => ui.pickAndUpload(target),
          } satisfies MenuAction,
          {
            label: 'Neuer Ordner',
            icon: 'folder',
            onSelect: () => ui.newFolder(target),
          } satisfies MenuAction,
        ]
      : []),
    ...(canHaveAreasUnder(ui.home?.areas ?? [], area)
      ? [
          {
            label: 'Neuer Unterbereich',
            icon: 'workspaces',
            onSelect: () => ui.newArea(area),
          } satisfies MenuAction,
        ]
      : []),
    ...(manage
      ? [
          // The workspace's own: its people are the workspace's, and it stays.
          ...(area.root
            ? []
            : [
                {
                  label: 'Personen …',
                  icon: 'groups',
                  onSelect: () => ui.areaPeople(area),
                } satisfies MenuAction,
              ]),
          {
            label: 'Bereich bearbeiten',
            icon: 'edit',
            onSelect: () => ui.editArea(area),
          } satisfies MenuAction,
          ...(isWorkspaceOwn(area)
            ? []
            : [
                {
                  label: 'Löschen',
                  icon: 'delete',
                  tone: 'danger',
                  onSelect: () => ui.deleteArea(area),
                } satisfies MenuAction,
              ]),
        ]
      : []),
  ];
  const toggles = open !== null && !folded;
  // The workspace's own row is where a new area is made: every area stands under it.
  const adds = area.root && !!ui.home?.canCreateAreas && !folded;
  const areaTo = routes.cloudArea(ui.workspace.id, area.id);
  return (
    <div className="group/area relative flex shrink-0 flex-col">
      <NavLink
        to={areaTo}
        title={folded ? area.name : undefined}
        {...(ui.barRow && ui.barRow !== areaTo ? { 'aria-current': false as const } : {})}
        className={(state) =>
          cn(
            // Its agents and folders, whose addresses are not under it, light it too.
            rowClass({ isActive: ui.barRow ? ui.barRow === areaTo : state.isActive }),
            'h-8',
            folded && foldedRow,
            (toggles || adds) && 'pr-8',
            drop.over && overClass,
          )
        }
        {...drop.handlers}
        // An area under another stands in from it, a step per level (not as a dot alone).
        style={depth > 0 && !folded ? { paddingLeft: 10 + depth * 16 } : undefined}
        onContextMenu={(event) => {
          if (actions.length === 0) return;
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          <AreaMark area={area} />
        </span>
        <span className={cn('min-w-0 flex-1 truncate', folded && foldedHide)}>{area.name}</span>
        {area.visibility === 'members' && (
          <Icon
            name="lock"
            size={12}
            className={cn('text-fg-faint', folded && foldedHide)}
            label="Nur für seine Personen"
          />
        )}
      </NavLink>
      {adds && (
        <span className="absolute top-1 right-1 flex">
          <IconButton
            icon="add"
            label="Neuer Bereich"
            size="xs"
            iconSize={16}
            variant="subtle"
            onClick={() => ui.newArea()}
          />
        </span>
      )}
      {toggles && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={
            open
              ? `Unterbereiche von ${area.name} einklappen`
              : `Unterbereiche von ${area.name} ausklappen`
          }
          onClick={onToggle}
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-chip text-fg-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <Icon name={open ? 'expandMore' : 'chevronRight'} size={16} />
        </button>
      )}
      {menuAt && (
        <ContextMenu
          label={`Aktionen für den Bereich ${area.name}`}
          actions={actions}
          at={menuAt}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}

/**
 * A person, group or agent one writes with – Sender's „Direkt“, under the areas. Its menu (right
 * click, long press) pins it to the top of the chats or lets it go.
 */
function ChatRow({
  chat,
  to,
}: {
  chat: SenderChannel | SenderAgent | MailThreadSummary;
  to: string;
}) {
  const ui = useCloud();
  const folded = use(Folded);
  const menu = useRowMenu();
  const pinAction = usePinAction(ui.workspace.id, ui.notify);
  const muteAction = useMuteAction(ui.workspace.id, ui.notify);
  const unreadAction = useUnreadAction(ui.workspace.id, ui.notify);
  const { pathname } = useLocation();
  const remove = useDeleteAgentAction({
    agent: !isMailChat(chat) && 'title' in chat ? chat : null,
    to,
    homePath: routes.cloud(ui.workspace.id),
    workspaceId: ui.workspace.id,
    notify: ui.notify,
  });
  // A mail a colleague is on: as a group.
  const mark = isMailChat(chat) ? (
    <Icon name="groups" size={18} />
  ) : 'title' in chat ? (
    <AgentFace
      agent={chat}
      size={18}
      showArea
      areas={ui.home?.areas}
      workspace={ui.workspace}
      working={chat.running}
      className="rounded-mark"
    />
  ) : chat.person ? (
    <PersonFace person={chat.person} size={18} workspaceId={ui.workspace.id} />
  ) : (
    <Icon name="groups" size={18} />
  );
  const name = isMailChat(chat) ? mailGroupName(chat) : 'title' in chat ? chat.title : chat.name;
  const conversation = !isMailChat(chat) && !('title' in chat) ? chat : null;
  const mentioned = Boolean(conversation?.mentioned);
  // Muted: its count goes, an „@“ still shows – as in Sender's bar.
  const count = conversation?.muted ? 0 : chat.unread;
  const unread = count > 0 || mentioned;
  return (
    <>
      <NavLink
        to={to}
        title={folded ? name : undefined}
        {...menu.props}
        className={(state) =>
          cn(
            rowClass(state),
            'h-8 shrink-0',
            unread && !state.isActive && 'font-semibold text-fg',
            folded && foldedRow,
            ROW_MENU_CLASS,
          )
        }
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">{mark}</span>
        <span className={cn('min-w-0 flex-1 truncate', folded && foldedHide)}>{name}</span>
        {chat.pinnedAt && <PinnedMark className={cn(folded && foldedHide)} />}
        {conversation?.muted && <MutedMark className={cn(folded && foldedHide)} />}
        <span className={cn('flex', folded && foldedHide)}>
          <Unread count={count} mentioned={mentioned} />
        </span>
      </NavLink>
      {menu.at && (
        <ContextMenu
          label={`Aktionen für „${name}“`}
          actions={[
            pinAction(pinKindOf(chat), chat.id, chat.pinnedAt),
            ...(conversation
              ? [
                  unreadAction(
                    conversation,
                    pathname.startsWith(to) ? routes.cloud(ui.workspace.id) : undefined,
                  ),
                  muteAction(conversation),
                ]
              : []),
            ...remove.actions,
          ]}
          at={menu.at}
          onClose={menu.close}
        />
      )}
      {remove.dialog}
    </>
  );
}

/**
 * Cloud's start („Zuletzt“) as the bar's first button, beside „Neu“: the ink of the bar, the
 * same from every page.
 */
function HomeButton() {
  const ui = useCloud();
  const folded = use(Folded);
  // As the rows: under „Neu“'s page (`?neu=`) the page it was opened from is not where one is.
  const [params] = useSearchParams();
  return (
    <BarStartLink
      to={routes.cloud(ui.workspace.id)}
      label="Zuletzt"
      away={isNewKind(params.get('neu'))}
      folded={folded}
    />
  );
}

/**
 * „Neu“: what can be made or brought here – into the open folder or area. `start` stands before
 * it (the bar's start): folded, „Neu“ gives up its place and opens with a right click on it.
 */
function NewMenu({ start }: { start: ReactNode }) {
  const ui = useCloud();
  const sender = useSenderOrNull();
  const navigate = useNavigate();
  const createDocument = useCreateDocument(ui.workspace.id);
  const event = useShownEvent();
  const { open, setOpen, close, wrapperRef, panelId, triggerProps } = usePopover({
    hasPopup: 'menu',
  });
  const run = (action: () => void) => () => {
    close();
    action();
  };
  const folded = use(Folded);
  const { workspace, place } = ui;
  const makes = canCreateDecks(workspace.role);
  // An area open (not a folder in it): its own Aufgaben and Agenten; else the overviews.
  const area = place.areaId ? ui.home?.areas.find((each) => each.id === place.areaId) : undefined;
  const newDocument = () =>
    createDocument.mutate(
      { template: 'plain', parentId: place.parentId, areaId: place.areaId },
      {
        onSuccess: (document) => void navigate(routes.document(document.id)),
        onError: (error) => ui.notify(error.message, 'danger'),
      },
    );
  return (
    <div
      ref={wrapperRef}
      className="relative flex min-w-0 flex-1 gap-2"
      onContextMenu={
        folded
          ? (event) => {
              event.preventDefault();
              setOpen(true);
            }
          : undefined
      }
    >
      {start}
      <Button
        {...triggerProps}
        variant="secondary"
        size="md"
        icon="add"
        // Half the row, the start the other half.
        className={cn('min-w-0 flex-1', folded && foldedHide)}
      >
        Neu
      </Button>
      {open && (
        // Open, out of its corner at the bar's right edge, as wide as the bar; folded, over the page.
        <PopoverPanel
          id={panelId}
          padding="md"
          align={folded ? 'start' : 'end'}
          className="w-57"
          role="menu"
        >
          <MenuItem icon="uploadFile" onClick={run(() => ui.pickAndUpload(ui.place))}>
            Dateien hochladen
          </MenuItem>
          <MenuItem icon="driveFolderUpload" onClick={run(() => ui.pickAndUpload(ui.place, true))}>
            Ordner hochladen
          </MenuItem>
          <MenuItem icon="createNewFolder" onClick={run(() => ui.newFolder(ui.place))}>
            Neuer Ordner
          </MenuItem>
          <p className="px-2.5 pt-1 pb-1 text-caption text-fg-subtle">Nach „{ui.place.name}“</p>
          {(makes || ui.home?.canCreateAreas) && <MenuDivider />}
          {makes && (
            <MenuItem
              icon="slideshow"
              onClick={run(() => void navigate(routes.newReview(workspace.id, place)))}
            >
              Neue Präsentation
            </MenuItem>
          )}
          {makes && (
            <MenuItem icon="article" onClick={run(newDocument)}>
              Neues Dokument
            </MenuItem>
          )}
          {ui.home?.canCreateAreas && (
            <MenuItem icon="workspaces" onClick={run(() => ui.newArea())}>
              Neuer Bereich
            </MenuItem>
          )}
          {/* What is to be done and when: each typed where it stands – the field of Aufgaben or
            Agenten (the area's, an area open), the event beside the page. */}
          <MenuDivider />
          <MenuItem
            icon="checklist"
            onClick={run(
              () =>
                void navigate(
                  area
                    ? routes.cloudAreaTodos(workspace.id, area.id)
                    : routes.cloudTodos(workspace.id),
                ),
            )}
          >
            Neue Aufgabe
          </MenuItem>
          <MenuItem
            icon="event"
            onClick={run(() => event.create({ day: new Date().toLocaleDateString('sv-SE') }))}
          >
            Neuer Termin
          </MenuItem>
          {makes && (
            <MenuItem
              icon="autoAwesome"
              onClick={run(
                () =>
                  void navigate(
                    area && !isWorkspaceOwn(area)
                      ? routes.cloudAreaAgents(workspace.id, area.id)
                      : routes.cloudAgents(workspace.id),
                  ),
              )}
            >
              Neuer Agent
            </MenuItem>
          )}
          {sender && (
            <>
              <MenuDivider />
              <MenuItem icon="groups" onClick={run(() => void navigate(sender.newPath('gruppe')))}>
                Neue Gruppe
              </MenuItem>
              <MenuItem
                icon="mail"
                onClick={run(() => void navigate(sender.mailThreadPath(NEW_MAIL)))}
              >
                Neue Mail
              </MenuItem>
            </>
          )}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * Cloud's side bar: its start beside „Neu“, the lists across folders, the areas with their
 * colours, and at its foot how full the workspace is.
 */
export function CloudSidebar({
  className,
  folded = false,
  onFold,
}: {
  className?: string;
  /** Icons alone (where the bar stands beside the page). */
  folded?: boolean;
  onFold: (folded: boolean) => void;
}) {
  const ui = useCloud();
  const sender = useSenderOrNull();
  const threads = useMailThreads(ui.workspace.id).data;
  const chats = withMailChats(chatsOf(sender?.home), threads);
  const drafts = useWorkspaceDrafts();
  // What is one's to do: one's own and an area's given to one – open.
  const todos = useTodos(ui.workspace.id).data ?? [];
  const myTodos = todos.filter((todo) => isMine(todo, ui.userId)).length;
  const search = useBarSearch();
  const { query, setQuery } = search;
  const searching = !folded && search.searching;
  const filesInto = useFilesInto();
  const { workspace, home } = ui;
  const [closedAreas, toggleArea] = useClosedAreas();
  const shownAreas = areasShown(home?.areas ?? [], closedAreas);
  const [sizes, setSizes] = useBarSizes();
  const placesRef = useRef<HTMLDivElement>(null);
  const areasRef = useRef<HTMLDivElement>(null);
  // The areas' default: the first eight rows, the chats below open downwards.
  const [eight, setEight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const rows = areasRef.current?.children;
    const first = rows?.[0] as HTMLElement | undefined;
    const last = rows?.[Math.min(rows.length, AREAS_SHOWN) - 1] as HTMLElement | undefined;
    setEight(first && last ? last.offsetTop + last.offsetHeight - first.offsetTop : null);
  }, [shownAreas.length, folded, searching]);
  // „Übersicht“ is the admins' page: for them the meter is the way to it.
  const overviewTo = workspace.role === 'admin' ? routes.cloudOverview(workspace.id) : null;
  return (
    <Folded value={folded}>
      <nav
        aria-label="Cloud"
        className={cn(
          // Room at its foot for the meter fixed there – open or folded the same (46px and a gap).
          'relative flex w-57 shrink-0 flex-col gap-0.5 lg:pb-16',
          // Folding and unfolding glides: the page beside it follows the width.
          'lg:transition-[width] lg:duration-200 lg:ease-emphasized motion-reduce:transition-none',
          folded && 'lg:w-[38px]',
          className,
        )}
      >
        {/* Over „Zuletzt“ and „Neu“, level with the path beside it. */}
        <IconButton
          // The icon tells the state – its left part filled while the bar is open; no background.
          icon={folded ? 'sidePanel' : 'sidePanelOpen'}
          label={folded ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
          size="sm"
          variant="subtle"
          aria-expanded={!folded}
          onClick={() => onFold(!folded)}
          className={cn(
            'absolute -top-9 z-(--z-overlay) transition-[left] duration-200 ease-emphasized max-lg:hidden aria-expanded:bg-transparent aria-expanded:text-fg-subtle aria-expanded:hover:bg-hover aria-expanded:hover:text-fg motion-reduce:transition-none',
            folded ? 'left-[3px]' : '-left-1',
          )}
        />
        {/* Cloud's start and „Neu“ side by side – folded, the start alone, „Neu“ on its right
          click. Who only looks (by their role in the workspace) makes nothing and has no own
          files: the start alone. */}
        <div className="flex shrink-0 gap-2">
          {home?.ownFiles !== false ? <NewMenu start={<HomeButton />} /> : <HomeButton />}
        </div>
        {/* One field for all of it – files, areas, chats, people; the hits stand in the bar. */}
        {/* Folded, the field's place keeps its height: a magnifier there opens what ⌘F opens –
          the rows below stand where they stand open. */}
        <div className="mt-2 shrink-0">
          {folded ? (
            <button
              type="button"
              title="Suchen"
              aria-label="Suchen"
              onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
              className="glass flex h-10 w-[38px] items-center justify-center rounded-control text-fg-subtle transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              <Icon name="search" size={20} />
            </button>
          ) : (
            <BarSearchField
              query={query}
              onQuery={setQuery}
              label="Dateien, Bereiche, Chats, Personen und Mails suchen"
              marked={{ 'data-cloud-search': 'bar' }}
            />
          )}
        </div>
        <div className="h-2 shrink-0" />
        {searching ? (
          <BarHits query={query} onPicked={() => setQuery('')} />
        ) : (
          <>
            {/* The places, whole by default; the handle under them gives the areas more room. */}
            <div
              ref={placesRef}
              className="scrollbar-none flex shrink-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto"
              style={sizes.places === null ? undefined : { height: sizes.places }}
            >
              {home?.ownFiles !== false && (
                // Dropped on, it goes to one's own – as what comes in on „Dateien“'s „Alle“.
                <NavRow
                  to={routes.cloudFiles(workspace.id)}
                  icon="folder"
                  onNodes={(nodes) => ui.moveInto(nodes, OWN_FILES)}
                  onFiles={(data) => filesInto(data, OWN_FILES)}
                >
                  Dateien
                </NavRow>
              )}
              <NavRow to={routes.cloudAgents(workspace.id)} icon="autoAwesome">
                Agenten
              </NavRow>
              <NavRow to={routes.cloudTodos(workspace.id)} icon="checklist" count={myTodos}>
                Aufgaben
              </NavRow>
              {/* Files, agents and to-dos first – each an overview of one's own, the workspace's and
                every area's –, then the places, set apart by a line. */}
              {/* The same line as the handles' (`BarHandle`), only not dragged. */}
              <div role="separator" className="mx-2 flex h-4 shrink-0 items-center">
                <div className="h-px w-full bg-hairline-strong" />
              </div>
              <NavRow to={routes.cloudConnections(workspace.id)} icon="link">
                Verbindungen
              </NavRow>
              {/* Only where something is shared: a presentation open to chosen people lies here. */}
              {(home?.sharing || home?.shared) && (
                <NavRow
                  to={routes.cloudShared(workspace.id)}
                  icon="folderShared"
                  count={home.counts.sharedNew}
                >
                  Geteilt
                </NavRow>
              )}
              {/* What was written in any chat and not sent – across areas, groups and people. */}
              {sender && (
                <NavRow to={routes.cloudDrafts(workspace.id)} icon="edit" count={drafts.length}>
                  Entwürfe
                </NavRow>
              )}
              {/* Mail from outside – a colleague's lands in the chat with them. */}
              {sender && (
                <NavRow
                  to={routes.cloudMail(workspace.id)}
                  icon="mail"
                  count={unreadMailOf(threads)}
                >
                  Post
                </NavRow>
              )}
              {home?.ownFiles !== false && (
                <NavRow
                  to={routes.cloudTrash(workspace.id)}
                  icon="delete"
                  count={home?.counts.trash}
                  // As the delete key: only what is the caller's to delete.
                  onNodes={(nodes) => {
                    if (ui.actionsFor(nodes).some((action) => action.tone === 'danger'))
                      ui.trash(nodes);
                  }}
                >
                  Gelöscht
                </NavRow>
              )}
              {home && home.pins.length > 0 && (
                <>
                  <p
                    className={cn(
                      'flex h-9 shrink-0 items-end pb-1.5 pl-2.5 text-caption font-semibold tracking-wider text-fg-subtle uppercase',
                      folded && foldedHide,
                    )}
                  >
                    Angepinnt
                  </p>
                  {folded && <div className="mx-2 my-2 hidden border-t border-hairline lg:block" />}
                  {home.pins.map((pin) => (
                    <PinRow key={pin.id} pin={pin} />
                  ))}
                </>
              )}
            </div>
            {/* The workspace's own, set apart by a line: the workspace as the home of its areas –
          no heading over them, a new one is made from its row. The lines are handles. */}
            <BarHandle
              label="Orte und Bereiche"
              target={placesRef}
              onSize={(height) => setSizes({ places: height })}
              onReset={() => setSizes({ places: null })}
            />
            {/* Areas and chats scroll each on their own: the areas show their first eight (or
              as many as the handle under them says), the chats take the rest. */}
            <div
              ref={areasRef}
              className="scrollbar-none flex min-h-0 shrink grow-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto"
              style={
                !(sender && chats.length > 0) || sizes.areas === 'all'
                  ? undefined
                  : typeof sizes.areas === 'number'
                    ? { height: sizes.areas }
                    : eight !== null
                      ? { height: eight }
                      : undefined
              }
            >
              {shownAreas.map(({ area, depth, open }) => (
                <AreaRow
                  key={area.id}
                  area={area}
                  depth={depth}
                  open={open}
                  onToggle={() => toggleArea(area.id)}
                />
              ))}
              {home && home.areas.length === 0 && (
                <p
                  className={cn(
                    'px-2.5 py-1 text-xs leading-4.5 text-fg-subtle',
                    folded && foldedHide,
                  )}
                >
                  {home.canCreateAreas
                    ? 'Noch kein Bereich. Leg einen für dein Team an.'
                    : 'Noch kein Bereich für dich.'}
                </p>
              )}
            </div>
            {/* The chats outside the areas – people, groups, agents – set apart by a line as the
            areas are from the places; the field at the top finds a person to start one with. */}
            {sender && chats.length > 0 && (
              <>
                <BarHandle
                  label="Bereiche und Chats"
                  target={areasRef}
                  onSize={(height) => setSizes({ areas: height })}
                  // Back to the first eight – there, all of them.
                  onReset={() => setSizes({ areas: sizes.areas === null ? 'all' : null })}
                />
                <div className="scrollbar-none flex min-h-0 flex-1 basis-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
                  {chats.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      to={
                        isMailChat(chat)
                          ? sender.mailThreadPath(chat.id)
                          : 'title' in chat
                            ? sender.agentPath(chat.id)
                            : sender.pathOf(chat)
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {/*
        The bar sticks to the top and is as tall as the window less the header, so once the
        header has scrolled away its end stands a header's height above the window's: the meter
        holds on to the window instead. (Below lg the bar is a panel that never scrolls.)
      */}
        <div
          className={cn(
            'mt-auto flex flex-col gap-3 pt-8 lg:fixed lg:bottom-4 lg:w-57 lg:pt-0',
            folded && 'lg:w-[38px]',
          )}
        >
          {home && (
            <>
              {/* A row's box: its text where the rows' icons begin, as high as the ring's folded. */}
              <div className={cn(folded && foldedHide)}>
                {overviewTo ? (
                  <NavLink
                    to={overviewTo}
                    title="Übersicht öffnen"
                    className={({ isActive }) =>
                      cn(
                        'block rounded-chip transition-colors',
                        FOOT_BOX,
                        isActive ? 'bg-selected' : 'hover:bg-hover',
                      )
                    }
                  >
                    <StorageMeter storage={home.storage} />
                  </NavLink>
                ) : (
                  <div className={FOOT_BOX}>
                    <StorageMeter storage={home.storage} />
                  </div>
                )}
              </div>
              {/* Folded there is no room for the bar: the same parts as a ring, in the middle of the
                  icons' column (the tooltip's box is that wide, its content not by itself). */}
              {folded && (
                <Tooltip label={`Speicher | ${usedText(home.storage)}`} decorative>
                  {overviewTo ? (
                    <NavLink
                      to={overviewTo}
                      aria-label="Übersicht öffnen"
                      className={({ isActive }) =>
                        cn(
                          'hidden h-[46px] w-full items-center justify-center rounded-chip transition-colors lg:flex',
                          isActive ? 'bg-selected' : 'hover:bg-hover',
                        )
                      }
                    >
                      <StorageRing storage={home.storage} />
                    </NavLink>
                  ) : (
                    <span className="hidden h-[46px] w-full items-center justify-center lg:flex">
                      <StorageRing storage={home.storage} />
                    </span>
                  )}
                </Tooltip>
              )}
            </>
          )}
        </div>
      </nav>
    </Folded>
  );
}

const CLOSED_KEY = 'slider.cloud.areasClosed';
const SIZES_KEY = 'slider.cloud.barSizes';
/** How many areas show by default; the chats below take the rest. */
const AREAS_SHOWN = 8;

interface BarSizes {
  /** The places' height; `null`: whole. */
  places: number | null;
  /** The areas' height; `null`: the first eight, `all`: every one. */
  areas: number | 'all' | null;
}

/** Where the side bar's handles stand – kept in this browser. */
function useBarSizes() {
  const [sizes, setSizes] = useState<BarSizes>(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Partial<BarSizes>;
      return {
        places: typeof kept.places === 'number' ? kept.places : null,
        areas: typeof kept.areas === 'number' || kept.areas === 'all' ? kept.areas : null,
      };
    } catch {
      return { places: null, areas: null };
    }
  });
  const change = (part: Partial<BarSizes>) =>
    setSizes((before) => {
      const next = { ...before, ...part };
      try {
        localStorage.setItem(SIZES_KEY, JSON.stringify(next));
      } catch {
        // Not kept, then: it still holds for now.
      }
      return next;
    });
  return [sizes, change] as const;
}

/** The areas whose sub-areas are folded away – kept in this browser. */
function useClosedAreas() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (areaId: string) =>
    setClosed((before) => {
      const next = new Set(before);
      if (!next.delete(areaId)) next.add(areaId);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
      } catch {
        // Not kept, then: it still folds for now.
      }
      return next;
    });
  return [closed, toggle] as const;
}

/**
 * The side bar's areas in order, without those under a folded one. First the workspace itself
 * as the home of the areas people set up – they stand under it, flush with it: only an area in
 * another stands in.
 */
function areasShown(areas: readonly CloudArea[], closed: ReadonlySet<string>) {
  const root = areas.find((area) => area.root);
  const made = areaTree(areas.filter((area) => !isWorkspaceOwn(area)));
  const tree = [...(root ? [{ area: root, depth: 0 }] : []), ...made];
  const shown: { area: CloudArea; depth: number; open: boolean | null }[] = [];
  // Rows deeper than this are under a folded area.
  let hideBelow = Infinity;
  tree.forEach(({ area, depth }, index) => {
    if (depth > hideBelow) return;
    hideBelow = Infinity;
    // The workspace's own does not fold: it is the home the others stand in, not a group of them.
    const parent = !area.root && (tree[index + 1]?.depth ?? 0) > depth;
    const open = parent ? !closed.has(area.id) : null;
    if (open === false) hideBelow = depth;
    shown.push({ area, depth, open });
  });
  return shown;
}
