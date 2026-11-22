import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { API_PREFIX, cloudAccessAtLeast, cloudPaths, type CloudNode } from '@slider/shared';
import { selectableItemProps, type SelectableItems } from '@/lib/collection-selection';
import { formatDateTime, formatFileSize, formatRelativeTime, pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  Avatar,
  Badge,
  cn,
  ContextMenu,
  Icon,
  IconButton,
  Menu,
  highlightedCardClass,
  highlightedRowClass,
  selectedRowClass,
  Tooltip,
} from '@/ui';
import { useCloud, type CloudUi } from '../hooks/useCloud';
import { useOnThisComputer } from '../lib/computer';
import { flyStyle } from '../lib/fly';
import { carriesNodes, carryNodes, NODES_DRAG } from '../lib/drag';
import { FILE_KINDS } from '../lib/kinds';
import { folderSummary, type CloudView } from '../lib/kinds';
import { DROP_FAILED, droppedFiles } from '../lib/upload';
import { AgentAvatar } from './AgentAvatar';
import { AreaDot, areaColor } from './AreaDot';
import { Fetching } from './Fetching';
import { FileIcon } from './FileIcon';
import { NodeNameInput } from './NodeNameInput';

/** What the columns beside the name say: in a folder, in a list across folders, in „Gelöscht“. */
export type BrowserMode = 'folder' | 'across' | 'trash';

/** The page's selection (`CloudPage`): `pickOne` makes a clicked file the one picked. */
export interface CloudItems extends SelectableItems {
  pickOne?: (id: string) => void;
}

interface BrowserProps {
  nodes: readonly CloudNode[];
  mode: BrowserMode;
  view: CloudView;
  selection: CloudItems;
  /** Folders as cards above the files (a folder's own list); else they are rows like files. */
  folderCards?: boolean;
  /** As rows, a line under a name – where the search found it in the file. */
  notes?: Readonly<Record<string, string>> | undefined;
}

// ── One item, however it is drawn ───────────────────────────────────────────

/**
 * A file's clicks, the same wherever it stands: one click picks it – the selection, then, is this
 * one (`pick`) – and shows its details beside, a double click – or Enter on it – opens it
 * (`ui.open`). ⌘/Ctrl/Shift-clicks are the selection's.
 */
export function fileClicks(ui: CloudUi, node: CloudNode, pick?: (id: string) => void) {
  return {
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      // Enter on the name is a click without a pointer (`detail` 0): the double click.
      if (event.detail === 0) return ui.open(node);
      // Safari leaves a clicked link unfocused: Enter and ↑/↓ are to find it.
      event.currentTarget.focus();
      pick?.(node.id);
      ui.openFile(node.id);
    },
    onDoubleClick: () => ui.open(node),
  };
}

/** Everything a row, a tile and a folder card share: selecting, its menu, dragging, dropping. */
export function useItem(node: CloudNode, selection: CloudItems, nodes: readonly CloudNode[]) {
  const ui = useCloud();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const selected = selection.selected.has(node.id);
  // One picked (a click, ↑/↓) is the one in hand: shown, not marked as a selection of several.
  const alone = selected && selection.selected.size === 1;
  const editable = cloudAccessAtLeast(node.access, 'edit') && !node.deleted;
  const droppable = node.kind === 'folder' && editable;
  const accepts = (event: DragEvent) =>
    droppable &&
    (event.dataTransfer.types.includes('Files') ||
      (ui.dragged().length > 0
        ? !ui.dragged().some((each) => each.id === node.id)
        : // Out of another page of the app.
          carriesNodes(event.dataTransfer)));

  const props = {
    ...selectableItemProps(node.id, selection),
    onContextMenu: (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      setMenuAt({ x: event.clientX, y: event.clientY });
    },
    // Not while its name is a field: dragging there marks text.
    draggable: editable && ui.renaming?.id !== node.id,
    onDragStart: (event: DragEvent) => {
      // One of several picked: they all go; else just this one.
      const dragged = selected ? nodes.filter((each) => selection.selected.has(each.id)) : [node];
      ui.setDragged(dragged);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.name);
      carryNodes(event.dataTransfer, ui.workspace.id, dragged);
    },
    onDragEnd: (event: DragEvent) => {
      // Still set: no place in this page took it – another page of the app may have.
      if (ui.dragged().length > 0 && event.dataTransfer.dropEffect !== 'none') ui.sentAway();
      ui.setDragged([]);
    },
    ...(droppable && {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect =
          ui.dragged().length > 0 || carriesNodes(event.dataTransfer) ? 'move' : 'copy';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const target = { parentId: node.id, name: node.name };
        const moved = ui.dragged();
        if (moved.length > 0) {
          ui.setDragged([]);
          ui.moveInto(moved, target);
        } else if (carriesNodes(event.dataTransfer)) {
          ui.takeFrom(event.dataTransfer.getData(NODES_DRAG), target);
        } else {
          droppedFiles(event.dataTransfer).then(
            (files) => ui.upload(files, target),
            () => ui.notify(DROP_FAILED, 'danger'),
          );
        }
      },
    }),
  };
  const menu = menuAt && (
    <ContextMenu
      label={`Aktionen für „${node.name}“`}
      actions={ui.actionsFor([node])}
      at={menuAt}
      onClose={() => setMenuAt(null)}
    />
  );
  return { ui, selected, alone, over, editable, props, menu };
}

/** The name as the one link of the item, stretched over all of it – a field while it is renamed. */
export function NameLink({
  node,
  className,
  onPick,
  pick,
  lines = 1,
}: {
  node: CloudNode;
  className?: string;
  /** A plain click on a file makes it the one picked (`CloudItems.pickOne`). */
  pick?: ((id: string) => void) | undefined;
  /** On a card a long name may take a second line; in rows it is cut. */
  lines?: 1 | 2;
  /** In columns: a plain click tells which row it was; a folder then opens beside, not as the page. */
  onPick?: (node: CloudNode) => void;
}) {
  const ui = useCloud();
  const link = useRef<HTMLAnchorElement>(null);
  const renaming = ui.renaming?.where === 'list' && ui.renaming.id === node.id;
  // Ended with Enter or Escape, the focus goes back to the name – the field it was on is gone.
  const refocus = useRef(false);
  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    link.current?.focus();
  }, [renaming]);
  if (renaming) {
    return (
      <NodeNameInput
        node={node}
        className={className}
        onDone={(hadFocus) => {
          refocus.current = hadFocus;
        }}
      />
    );
  }
  if (node.deleted) {
    // Deleted things open nowhere – brought back first.
    return <span className={cn('truncate', className)}>{node.name}</span>;
  }
  return (
    <Link
      ref={link}
      to={ui.hrefOf(node)}
      title={node.name}
      draggable={false}
      // ↑/↓ put the focus here (`CloudPage`).
      data-name
      // A folder opens at a click (in columns beside); a file shows its details (`fileClicks`).
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        onPick?.(node);
        if (node.kind === 'file') return fileClicks(ui, node, pick).onClick(event);
        if (onPick) event.preventDefault();
        else if (node.kind === 'folder' && node.peek?.length) {
          // What peeks out of it slides to its place inside (`ui.open`).
          event.preventDefault();
          ui.open(node);
        }
      }}
      onDoubleClick={() => {
        if (node.kind === 'file' || onPick) ui.open(node);
      }}
      className={cn(
        lines === 2 ? 'line-clamp-2 [overflow-wrap:anywhere]' : 'truncate',
        'outline-none after:absolute after:inset-0',
        className,
      )}
    >
      {node.name}
    </Link>
  );
}

/** A file's symbol in a row – while „Öffnen“ fetches the file, that instead. */
export function RowIcon({ node, size = 32 }: { node: CloudNode; size?: 20 | 32 }) {
  const state = useCloud().fetching.get(node.id);
  return state ? (
    <Fetching state={state} size={size} />
  ) : node.kind === 'folder' ? (
    <FolderMini node={node} size={size} />
  ) : (
    <FileIcon kind={node.kind} type={node.fileType} size={size} />
  );
}

/**
 * The front of a folder as a file's: on the left it stands at full height, a soft S over
 * `slope` px leads down to the right part, lower by `drop` (of its height) – no kink where it
 * leaves the top or meets the lower edge. Corners rounded by `radius` px.
 */
function flapShape(
  radius: number,
  slope: number,
  drop = '14.3%',
  tab = '42%',
  /** Only its upper edge, as a line this many px thick. */
  line = 0,
): string {
  const corner = (x: string, y: string, from: number, lower = 0) =>
    Array.from({ length: 5 }, (_, step) => {
      const angle = ((from + step * 22.5) * Math.PI) / 180;
      return `calc(${x} + ${(Math.cos(angle) * radius).toFixed(2)}px) calc(${y} + ${(Math.sin(angle) * radius + lower).toFixed(2)}px)`;
    });
  const near = `${radius}px`;
  const far = `100% - ${radius}px`;
  const top = (lower = 0) => [
    ...corner(near, near, 180, lower),
    ...Array.from({ length: 17 }, (_, step) => {
      const t = step / 16;
      // Smoothstep: flat where it starts and where it ends.
      const down = t * t * (3 - 2 * t);
      return `calc(${tab} + ${(slope * t).toFixed(2)}px) calc(${drop} * ${down.toFixed(4)} + ${lower}px)`;
    }),
    ...corner(far, `${drop} + ${radius}px`, 270, lower),
  ];
  const rest = line ? top(line).reverse() : [...corner(far, far, 0), ...corner(near, far, 90)];
  return `polygon(${[...top(), ...rest].join(', ')})`;
}
const CARD_FLAP = flapShape(14, 30, '14.3%', '38%');
const CARD_FLAP_EDGE = flapShape(14, 30, '14.3%', '38%', 1);
/** What the flap is made of – opaque colours (the surfaces are see-through): the page's ground a step lighter, or the folder's colour a step towards the ground. */
const FLAP_GROUND = (tinted: boolean) =>
  tinted
    ? 'color-mix(in srgb, var(--folder) 62%, var(--color-canvas))'
    : 'color-mix(in srgb, var(--color-canvas), var(--color-fg) 10%)';

/** A plain small folder's back – darker than its flap (`FLAP_GROUND`), so its front shows. */
const MINI_BACK = 'color-mix(in srgb, var(--color-canvas), var(--color-fg) 26%)';

/** Where the two sheets of a small folder lie, back to front, and where they go on hover. */
const MINI_SHEETS = [
  'left-[12%] right-[22%] top-[6%] group-hover:-translate-y-[14%] group-hover:-rotate-6',
  'left-[22%] right-[10%] top-[18%] group-hover:-translate-y-[10%] group-hover:rotate-3',
] as const;

/**
 * The folder of the cards (`FolderCard`), small, for a row: its back – plain or in its colour –
 * its newest files peeking out and the frosted flap in front, which tips on the row's hover.
 */
function FolderMini({ node, size }: { node: CloudNode; size: 20 | 32 }) {
  const peek = (node.peek ?? []).slice(0, MINI_SHEETS.length).reverse();
  const tint = node.color ? areaColor(node.color) : null;
  const radius = size === 32 ? 7 : 5;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span
        className="relative isolate block w-full [perspective:160px]"
        style={
          {
            height: Math.round(size * 0.82),
            ...(tint ? { '--folder': tint } : {}),
          } as CSSProperties
        }
      >
        <span
          className={cn(
            'absolute inset-0',
            tint ? 'bg-(--folder)' : 'inset-ring inset-ring-hairline',
          )}
          // Plain, a step darker than its flap: else the two were one tone and the folder an
          // empty square in a row.
          style={{ borderRadius: radius, ...(tint ? {} : { background: MINI_BACK }) }}
        />
        {peek.map((file, at) => (
          <MiniSheet key={file.id} file={file} className={MINI_SHEETS[at] ?? MINI_SHEETS[0]} />
        ))}
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 h-[70%] origin-bottom inset-ring inset-ring-white/20 backdrop-blur-[1.5px] backdrop-saturate-150 transition-transform duration-300 ease-out group-hover:[transform:rotateX(-24deg)] motion-reduce:transition-none',
          )}
          style={{
            background: `color-mix(in srgb, ${FLAP_GROUND(!!tint)} 78%, transparent)`,
            clipPath: flapShape(radius, size === 32 ? 6 : 4, '22%', '36%'),
          }}
        />
      </span>
    </span>
  );
}

function MiniSheet({
  file,
  className,
}: {
  file: NonNullable<CloudNode['peek']>[number];
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const look = FILE_KINDS[file.fileType];
  const pictured =
    (file.thumbnail || file.fileType === 'image' || file.fileType === 'pdf') && !failed;
  return (
    <span
      data-peek={file.id}
      className={cn(
        'absolute h-[80%] overflow-hidden rounded-[2px] bg-surface-1 ring-1 ring-black/10 transition-transform duration-300 ease-out motion-reduce:transition-none',
        !pictured && look.tile,
        className,
      )}
    >
      {pictured && (
        <img
          src={`${API_PREFIX}${cloudPaths.thumbnail(file.id, file.versionId)}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      )}
    </span>
  );
}

/** Cloud's app: the file's content is on this computer. */
function OnComputer({ node }: { node: CloudNode }) {
  const here = useOnThisComputer(useCloud().workspace.id).has(node.id);
  if (!here || node.deleted) return null;
  return (
    <Tooltip label="Auf diesem Computer" decorative>
      <Icon
        name="offlinePin"
        size={14}
        className="shrink-0 text-fg-subtle"
        label="Auf diesem Computer"
      />
    </Tooltip>
  );
}

/** Clicks on an agent's mark are its own: they neither pick nor open the file under it. */
const AGENT_STILL = {
  'data-no-select': true,
  onClick: (event: MouseEvent) => event.stopPropagation(),
  onDoubleClick: (event: MouseEvent) => event.stopPropagation(),
};

/**
 * The agents at work on it – each on its own copy, the original stays as it is until their
 * A click goes to the agent, whose desk lists what it did.
 */
function AgentsAt({ node }: { node: CloudNode }) {
  const workspaceId = useCloud().workspace.id;
  const link =
    'relative z-(--z-raised) flex shrink-0 rounded-control-sm outline-none focus-visible:ring-2 focus-visible:ring-focus';
  return (node.agents ?? []).slice(0, 3).map((agent) => {
    const label = `Agent „${agent.title}“ arbeitet daran`;
    return (
      <Fragment key={agent.id}>
        <Tooltip label={label} decorative>
          <Link
            to={routes.cloudAgent(workspaceId, agent.id)}
            aria-label={`${label} | Agent öffnen`}
            {...AGENT_STILL}
            className={link}
          >
            <AgentAvatar id={agent.id} size={24} className="rounded-[6px]" />
          </Link>
        </Tooltip>
      </Fragment>
    );
  });
}

/**
 * The same on a tile, where there is room to say it: a bar along the picture's lower edge with
 * the agents' faces and „Agent arbeitet“ – a click goes to the agent –, and for its person the
 * way to the work copy.
 */
function AgentsBar({ node }: { node: CloudNode }) {
  const workspaceId = useCloud().workspace.id;
  const agents = (node.agents ?? []).slice(0, 3);
  const [first] = agents;
  if (!first || node.deleted) return null;
  const words = agents.length === 1 ? 'Agent arbeitet' : `${agents.length} Agenten arbeiten`;
  const label = agents.length === 1 ? `Agent „${first.title}“ arbeitet daran` : `${words} daran`;
  const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-white';
  return (
    <span className="absolute inset-x-1.5 bottom-1.5 z-(--z-raised) flex items-center gap-1 rounded-control bg-scrim p-1 text-white backdrop-blur-sm">
      {/* The agent takes the bar's width: the way to the work copy stands at its right end. */}
      <Tooltip label={label} decorative display="flex" className="min-w-0 flex-1">
        <Link
          to={routes.cloudAgent(workspaceId, first.id)}
          aria-label={`${label} | Agent öffnen`}
          {...AGENT_STILL}
          className={cn('flex w-full min-w-0 items-center gap-2 rounded-control-sm', focus)}
        >
          <span className="flex shrink-0">
            {agents.map((agent) => (
              <AgentAvatar
                key={agent.id}
                id={agent.id}
                size={28}
                className="-ml-2 rounded-control-sm ring-1 ring-black/20 first:ml-0"
              />
            ))}
          </span>
          <span className="truncate text-xs font-medium">{words}</span>
        </Link>
      </Tooltip>
    </span>
  );
}

/** What else there is to know at a glance: shared, by link, how many versions. */
export function Marks({ node }: { node: CloudNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {node.deleted && node.deleted.daysLeft <= 3 && <Badge tone="warning">bald weg</Badge>}
      <OnComputer node={node} />
      {node.shared.link && (
        <Tooltip label="Per Link geteilt" decorative>
          <Icon name="link" size={14} className="text-fg-subtle" label="Per Link geteilt" />
        </Tooltip>
      )}
      {node.shared.people > 0 && (
        <Tooltip
          label={`Mit ${node.shared.people === 1 ? 'einer Person' : `${node.shared.people} Personen`} geteilt`}
          decorative
        >
          <Icon name="groups" size={14} className="text-fg-subtle" label="Geteilt" />
        </Tooltip>
      )}
      {node.kind === 'file' && node.versionCount > 1 && !node.deleted && (
        <Badge>{node.versionCount} Fassungen</Badge>
      )}
      {!node.deleted && <AgentsAt node={node} />}
    </span>
  );
}

/** The menu (in „Gelöscht“ the way back too) at the end of a row or in a tile's corner – above the stretched link. */
function ItemControls({ node, className }: { node: CloudNode; className?: string }) {
  const ui = useCloud();
  return (
    <span className={cn('relative z-(--z-raised) flex items-center justify-end', className)}>
      {node.deleted && (
        <IconButton
          icon="history"
          label={`„${node.name}“ wiederherstellen`}
          title="Wiederherstellen"
          size="sm"
          iconSize={18}
          onClick={() => ui.restore([node])}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        />
      )}
      <Menu label={`Aktionen für „${node.name}“`} actions={ui.actionsFor([node])} />
    </span>
  );
}

function Where({ node }: { node: CloudNode }) {
  const ui = useCloud();
  const location = node.location;
  if (!location) return null;
  const folders = location.folders.map((folder) => folder.name);
  // Reached only through a share: where it lies is its owner's business.
  const top =
    location.areaName ??
    (node.areaId === null && node.owner.id === ui.userId ? 'Meine Dateien' : null);
  return (
    <span className="flex min-w-0 items-center gap-2 text-body text-fg-muted">
      {location.areaColor && <AreaDot color={location.areaColor} />}
      <span className="truncate">
        {top ? [top, ...folders].join(' › ') : `Von ${node.owner.name}`}
      </span>
    </span>
  );
}

function Person({ node }: { node: CloudNode }) {
  const author = node.deleted ? node.deleted.by : node.updatedBy;
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-body text-fg-muted">
      <Avatar author={author} size={24} nativeTitle={false} />
      <span className="truncate">{author.name}</span>
    </span>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

const GRID: Record<BrowserMode, string> = {
  folder:
    'grid-cols-[minmax(0,1fr)_auto_72px] @xl:grid-cols-[minmax(0,1fr)_auto_112px_72px] @4xl:grid-cols-[minmax(0,1fr)_auto_112px_184px_80px_72px]',
  across:
    'grid-cols-[minmax(0,1fr)_auto_72px] @xl:grid-cols-[minmax(0,1fr)_auto_112px_72px] @4xl:grid-cols-[minmax(0,1fr)_auto_112px_minmax(0,220px)_80px_72px]',
  trash:
    'grid-cols-[minmax(0,1fr)_auto_72px] @xl:grid-cols-[minmax(0,1fr)_auto_112px_72px] @4xl:grid-cols-[minmax(0,1fr)_auto_112px_184px_80px_72px]',
};

const HEADS: Record<BrowserMode, readonly [string, string, string]> = {
  folder: ['Geändert', 'Von', 'Größe'],
  across: ['Geändert', 'Ort', 'Größe'],
  trash: ['Gelöscht', 'Von', 'Bleibt'],
};

function ColumnHeads({ mode }: { mode: BrowserMode }) {
  const [when, who, last] = HEADS[mode];
  return (
    <div
      aria-hidden
      className={cn('grid h-8 items-center gap-3 px-3 text-caption text-fg-subtle', GRID[mode])}
    >
      <span className="pl-[46px]">Name</span>
      <span />
      <span className="@max-xl:hidden">{when}</span>
      <span className="@max-4xl:hidden">{who}</span>
      <span className="text-right @max-4xl:hidden">{last}</span>
      <span />
    </div>
  );
}

function FileRow({
  node,
  nodes,
  mode,
  selection,
  note,
}: {
  node: CloudNode;
  nodes: readonly CloudNode[];
  mode: BrowserMode;
  selection: CloudItems;
  note?: string | undefined;
}) {
  const { selected, alone, over, props, menu } = useItem(node, selection, nodes);
  const when = node.deleted?.at ?? node.updatedAt;
  return (
    <li
      {...props}
      className={cn(
        'group relative grid h-13 items-center gap-3 rounded-control px-3 transition-colors hover:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus',
        GRID[mode],
        selected && (alone ? highlightedRowClass : selectedRowClass),
        over && 'bg-selected ring-1 ring-focus',
      )}
    >
      {/* As wide as its name, never wider than its column: a found line under it truncates. */}
      <div data-grip className="flex max-w-full min-w-0 items-center gap-3.5 justify-self-start">
        <RowIcon node={node} />
        {note ? (
          <span className="flex min-w-0 flex-col">
            <NameLink
              node={node}
              pick={selection.pickOne}
              className="text-sm font-medium text-fg"
            />
            <span className="truncate text-xs text-fg-subtle" title={note}>
              {note}
            </span>
          </span>
        ) : (
          <NameLink node={node} pick={selection.pickOne} className="text-sm font-medium text-fg" />
        )}
      </div>
      <Marks node={node} />
      <span
        className="truncate text-body text-fg-muted @max-xl:hidden"
        title={formatDateTime(when)}
      >
        {formatRelativeTime(when)}
      </span>
      <span className="min-w-0 @max-4xl:hidden">
        {mode === 'across' ? <Where node={node} /> : <Person node={node} />}
      </span>
      <span className="text-right text-body text-fg-subtle tabular-nums @max-4xl:hidden">
        {node.deleted
          ? `${node.deleted.daysLeft} ${node.deleted.daysLeft === 1 ? 'Tag' : 'Tage'}`
          : node.kind === 'folder' && node.sizeBytes === 0
            ? pluralize(node.fileCount ?? 0, 'Datei', 'Dateien')
            : formatFileSize(node.sizeBytes)}
      </span>
      <ItemControls node={node} />
      {menu}
    </li>
  );
}

// ── Cards and tiles ─────────────────────────────────────────────────────────

/** Where each of the sheets peeking out of a folder lies, back to front, and where it goes on hover. */
const SHEETS = [
  'left-[9%] right-[13%] top-3 group-hover:-translate-y-3 group-hover:-rotate-3',
  'left-[12%] right-[9%] top-5 group-hover:-translate-y-2.5 group-hover:rotate-2',
  'left-[7%] right-[11%] top-7 group-hover:-translate-y-2 group-hover:-rotate-1',
] as const;

/** One file peeking out of its folder: its small picture, else its kind's colour and symbol. */
function Sheet({
  file,
  className,
}: {
  file: NonNullable<CloudNode['peek']>[number];
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const look = FILE_KINDS[file.fileType];
  const pictured =
    (file.thumbnail || file.fileType === 'image' || file.fileType === 'pdf') && !failed;
  return (
    <span
      data-peek={file.id}
      className={cn(
        'absolute h-24 overflow-hidden rounded-control-sm bg-surface-1 shadow-float ring-1 ring-black/10 transition-transform duration-300 ease-out motion-reduce:transition-none',
        className,
      )}
    >
      {pictured ? (
        <img
          src={`${API_PREFIX}${cloudPaths.thumbnail(file.id, file.versionId)}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      ) : (
        <span className={cn('flex size-full items-start gap-1.5 p-2', look.tile, look.ink)}>
          <Icon name={look.icon} size={14} />
          <span className="mt-1 h-1 w-10 rounded-full bg-current opacity-40" />
        </span>
      )}
    </span>
  );
}

/**
 * A folder as a folder: a round back – plain, or in the folder's own colour – the newest files
 * peeking out, and a frosted
 * flap in front that blurs them – one guesses what is inside. On hover the flap tips forward and
 * the sheets rise and fan.
 */
function FolderCard({
  node,
  nodes,
  selection,
}: {
  node: CloudNode;
  nodes: readonly CloudNode[];
  selection: CloudItems;
}) {
  const { selected, alone, over, props, menu } = useItem(node, selection, nodes);
  const peek = node.peek ?? [];
  const tint = node.color ? areaColor(node.color) : null;
  return (
    <li
      {...props}
      className={cn(
        // `isolate` + the layers' `-z-10`: they paint behind the name, whose link covers the card.
        'group relative isolate flex h-[152px] flex-col justify-end rounded-panel p-4 [perspective:700px] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus',
        selected && (alone ? highlightedCardClass : 'ring-2 ring-(--selection)!'),
        over && 'ring-2 ring-focus!',
      )}
    >
      <span
        aria-hidden
        // The perspective stands on the flap's own parent – on the card it would not reach it,
        // and the flap would only shrink instead of tipping towards one.
        className="pointer-events-none absolute inset-0 -z-10 [perspective-origin:50%_100%] [perspective:520px]"
        style={tint ? ({ '--folder': tint } as CSSProperties) : undefined}
      >
        <span
          className={cn(
            'absolute inset-0 rounded-panel',
            tint ? 'bg-(--folder)' : 'bg-surface-2 inset-ring inset-ring-hairline',
          )}
        />
        {peek
          .slice(0, SHEETS.length)
          .reverse()
          .map((file, at) => (
            <Sheet key={file.id} file={file} className={SHEETS[at] ?? SHEETS[0]} />
          ))}
        {/* The flap: frosted glass, hinged at the bottom, cut as a file's front. */}
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 h-[70%] origin-bottom transition-transform duration-300 ease-out group-hover:[transform:rotateX(-22deg)] motion-reduce:transition-none',
            over && '[transform:rotateX(-32deg)]',
          )}
        >
          {/* Glass at the top – one guesses what is inside – dense where the name stands, so
              it reads over white sheets as over none. */}
          <span
            style={{
              clipPath: CARD_FLAP,
              background: `linear-gradient(to bottom, color-mix(in srgb, ${FLAP_GROUND(!!tint)} 30%, transparent) 0%, color-mix(in srgb, ${FLAP_GROUND(!!tint)} 86%, transparent) 58%)`,
            }}
            className="absolute inset-0 backdrop-blur-[10px] backdrop-brightness-75 backdrop-saturate-150"
          />
          {/* Its edge: a light line along the cut. */}
          <span style={{ clipPath: CARD_FLAP_EDGE }} className="absolute inset-0 bg-white/20" />
        </span>
      </span>
      <span className="absolute right-2 bottom-[calc(60%-40px)]">
        <ItemControls node={node} />
      </span>
      <div className="flex min-w-0 flex-col gap-1 pr-14">
        <NameLink
          node={node}
          pick={selection.pickOne}
          lines={2}
          className="text-sm leading-snug font-medium text-fg"
        />
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="truncate">{folderSummary(node, formatFileSize(node.sizeBytes))}</span>
          <Marks node={node} />
        </span>
      </div>
      {menu}
    </li>
  );
}

/** A file's small picture where there is one, else its symbol on a quiet ground. */
export function FilePicture({ node, className }: { node: CloudNode; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Pictures and PDFs draw theirs on first asking; everything else only once it is there.
  const may = node.thumbnail || node.fileType === 'image' || node.fileType === 'pdf';
  if (node.kind === 'file' && may && !failed && !node.deleted) {
    const src = `${API_PREFIX}${cloudPaths.thumbnail(node.id, node.versionId)}`;
    // A picture fills its tile; a document shows as the top of its first page, lying on it.
    return node.fileType === 'image' ? (
      <img
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', className)}
      />
    ) : (
      <span className={cn('block size-full overflow-hidden px-[14%] pt-[9%]', className)}>
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="w-full rounded-t-thumb shadow-float"
        />
      </span>
    );
  }
  return (
    <span className={cn('flex size-full items-center justify-center', className)}>
      <FileIcon kind={node.kind} type={node.fileType} size={56} />
    </span>
  );
}

function FileTile({
  node,
  nodes,
  mode,
  selection,
}: {
  node: CloudNode;
  nodes: readonly CloudNode[];
  mode: BrowserMode;
  selection: CloudItems;
}) {
  const { ui, selected, alone, over, props, menu } = useItem(node, selection, nodes);
  const fetching = ui.fetching.get(node.id);
  const when = node.deleted?.at ?? node.updatedAt;
  const meta: ReactNode =
    node.kind === 'folder'
      ? folderSummary(node, formatFileSize(node.sizeBytes))
      : `${mode === 'trash' ? node.deleted?.by.name : node.updatedBy.name} | ${formatRelativeTime(when)}`;
  return (
    <li {...props} className="group relative flex flex-col gap-2.5">
      <div
        data-flown
        style={flyStyle(node.id)}
        className={cn(
          'relative aspect-[5/3] overflow-hidden rounded-panel bg-surface-1 ring-hairline transition-[scale,background-color] duration-200 group-hover:bg-surface-2 group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-focus',
          selected && (alone ? highlightedCardClass : 'scale-[0.97] ring-2 ring-(--selection)!'),
          over && 'bg-selected ring-2 ring-focus!',
        )}
      >
        <FilePicture
          node={node}
          className={cn(
            'transition-[scale,filter] duration-300 ease-out',
            fetching === 'loading' && 'scale-95 brightness-50',
          )}
        />
        {fetching && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Fetching state={fetching} />
          </span>
        )}
        <AgentsBar node={node} />
        <ItemControls
          node={node}
          className="absolute top-1.5 right-1.5 rounded-control-sm bg-scrim opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100"
        />
      </div>
      <div className="flex min-w-0 items-start gap-2.5 px-0.5">
        <FileIcon kind={node.kind} type={node.fileType} size={20} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <NameLink
              node={node}
              pick={selection.pickOne}
              className="text-body font-medium text-fg"
            />
            <OnComputer node={node} />
          </span>
          <span className="truncate text-xs text-fg-muted">{meta}</span>
        </div>
      </div>
      {menu}
    </li>
  );
}

// ── The collection ──────────────────────────────────────────────────────────

const CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4';
const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-x-4 gap-y-6';

/**
 * Files and folders of one list – as rows or as tiles, the same items either way: a click
 * opens a folder and shows a file's details (a double click or Enter opens it), ⌘/Shift-click
 * and a dragged box select, a right click opens the menu, dragging onto a
 * folder moves there. As tiles a folder's own list has its folders first, as cards.
 */
export function FileBrowser({
  nodes,
  mode,
  view,
  selection,
  folderCards = false,
  notes,
}: BrowserProps) {
  const folders = folderCards ? nodes.filter((node) => node.kind === 'folder') : [];
  const rest = folderCards ? nodes.filter((node) => node.kind !== 'folder') : nodes;
  return (
    <div className="flex flex-col gap-5">
      {folders.length > 0 && (
        <ul aria-label="Ordner" className={CARD_GRID}>
          {folders.map((node) => (
            <FolderCard key={node.id} node={node} nodes={nodes} selection={selection} />
          ))}
        </ul>
      )}
      {rest.length > 0 &&
        (view === 'tiles' ? (
          <ul aria-label="Dateien" className={TILE_GRID}>
            {rest.map((node) => (
              <FileTile key={node.id} node={node} nodes={nodes} mode={mode} selection={selection} />
            ))}
          </ul>
        ) : (
          // Its columns by the room it has – narrower beside the details' panel than the window.
          <div className="@container">
            <ColumnHeads mode={mode} />
            <ul aria-label="Dateien" className="flex flex-col">
              {rest.map((node) => (
                <FileRow
                  key={node.id}
                  node={node}
                  nodes={nodes}
                  mode={mode}
                  selection={selection}
                  note={notes?.[node.id] || undefined}
                />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

/** Rows and tiles while a list loads. */
export function FileBrowserSkeleton({ view, rows = 6 }: { view: CloudView; rows?: number }) {
  if (view === 'tiles') {
    return (
      <div aria-hidden className={TILE_GRID}>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex flex-col gap-2.5">
            <div className="skeleton aspect-[5/3] rounded-panel" />
            <div className="skeleton h-4 w-2/3 rounded-mark" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className="flex flex-col pt-8">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-13 items-center gap-3.5 px-3">
          <div className="skeleton size-8 rounded-chip" />
          <div
            className="skeleton h-4 rounded-mark"
            style={{ width: `${28 + ((index * 17) % 30)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
