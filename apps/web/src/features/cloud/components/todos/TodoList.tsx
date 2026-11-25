import {
  DEFAULT_PROJECT_NAME,
  isOpenTodo,
  MAX_MILESTONE_NAME,
  MAX_PROJECT_NAME,
  searchFold,
  TODO_PRIORITIES,
  TODO_PRIORITY_LABELS,
  TODO_STATUS_LABELS,
  TODO_STATUSES,
  type Attachment,
  type CloudAgentSummary,
  type CloudArea,
  type CloudPerson,
  type Todo,
  type TodoChange,
  type TodoMilestone,
  type TodoProject,
} from '@slider/shared';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AttachButton,
  AttachmentChips,
  SentAttachments,
  useAttachments,
} from '@/features/attachments';
import {
  useCloudAgents,
  useCloudPeople,
  useCreateMilestone,
  useCreateProject,
  useCreateTodo,
  useDeleteProject,
  useMe,
  useMilestones,
  useProjects,
  useNewTodoAgent,
  useSendTodoAgent,
  useTodos,
  useUpdateProject,
  useUpdateTodo,
} from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import {
  CLOUD_CALL_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
  routes,
} from '@/lib/routes';
import { useDeckContextMenu } from '@/features/reviews';
import { canCreateDecks, ViewSearch } from '@/features/workspaces';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  ConfirmDialog,
  Icon,
  IconButton,
  LoadingState,
  MenuDivider,
  MenuHeading,
  Menu,
  MenuItem,
  PopoverPanel,
  SegmentedControl,
  SidePanel,
  TextField,
  TextLink,
  Toolbar,
  cn,
  useMediaQuery,
  usePopover,
} from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { useStoredChoice } from '../../hooks/useStoredChoice';
import {
  ALL_SCOPE,
  OWN_SCOPE,
  scopeTabs,
  useAssignedOnly,
  useProjectParam,
  useScope,
  WORKSPACE_SCOPE,
} from '../../lib/scopes';
import { AgentAvatar } from '../AgentAvatar';
import { GRID } from '../AgentList';
import { AreaDot } from '../AreaDot';
import { Empty } from '../Empty';
import { DueCalendar } from './DueCalendar';
import { TodoActions } from './TodoActions';
import { PriorityMark, StatusMark } from './TodoMarks';
import { TodoTimeline } from './TodoTimeline';
import { heldUpBy } from './timeline';
import { byUrgency, isMine } from './order';

/**
 * To-dos as Linear's issues at their simplest. `area` given: that area's, by status – a project's
 * plan; none: the overview of one's own and every area's one sees, by where they stand.
 */
export function TodoList({ area }: { area: CloudArea | null }) {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const todos = useTodos(workspaceId, area?.id ?? null);
  const milestones = useMilestones(workspaceId, area?.id ?? null);
  const projects = useProjects(workspaceId, area?.id ?? null);
  const [projectParam, setProject] = useProjectParam();
  const shown = useShownTodo();
  const [view, setView] = useStoredChoice('slider.cloud.todos-view', TODO_VIEWS, 'list');
  // The overview's open tab (the page's title); in an area all are the area's.
  const { tabs, current } = useTodoScope();
  const [assignedOnly] = useAssignedOnly();
  const areas = ui.home?.areas ?? [];
  const scope = area || current === ALL_SCOPE ? null : current;
  // Where a new one goes: the area open – in the overview the tab's, one's own on „Alle“.
  const target =
    area ??
    (scope === WORKSPACE_SCOPE
      ? (areas.find((each) => each.root) ?? null)
      : scope && scope !== OWN_SCOPE
        ? (areas.find((each) => each.id === scope) ?? null)
        : null);
  // Projects: an area's, or one's own on „Meine“ – never on „Alle“.
  const own = !area && scope === OWN_SCOPE;
  const projectPlace = target || own;
  const placeProjects = projectPlace
    ? (projects.data ?? []).filter((each) => each.areaId === (target?.id ?? null))
    : [];
  // The project open – the place's „Allgemein“ unless one of its own is picked.
  const project = placeProjects.find((each) => each.id === projectParam) ?? null;
  const projectId = project?.id ?? null;
  // The page's own field (⌘F): only those with every word in them.
  const [query, setQuery] = useState('');
  // On the timeline: the milestone new ones go to – one of the place they are made in (gone or of
  // another place: none).
  const [pickedId, setPicked] = useState<string | null>(null);
  if (!todos.data) return <LoadingState padding="lg" />;
  const all = todos.data;
  // A tab whose place is not known (yet): nothing of it – never one's own under its name.
  const lost = !!scope && scope !== OWN_SCOPE && !target;
  // One place – an area (its project open) or a tab of the overview; „Alle“ every one.
  const placed = !(area || scope)
    ? all
    : lost
      ? []
      : all.filter(
          (todo) =>
            todo.areaId === (target?.id ?? null) && (todo.project?.id ?? null) === projectId,
        );
  // „Mir zugeteilt“ (the page's title row): only those given to oneself.
  const mineOnly = !area && assignedOnly;
  const scoped = mineOnly ? placed.filter((todo) => todo.assignee?.id === ui.userId) : placed;
  const list = todosSaying(scoped, query);
  const canAdd = !lost && (!target || target.access === 'edit' || target.access === 'manage');
  const shownMilestones = (milestones.data ?? []).filter(
    (milestone) =>
      !(area || scope) ||
      (milestone.areaId === (target?.id ?? null) && milestone.projectId === projectId),
  );
  const picked =
    view === 'timeline'
      ? (shownMilestones.find(
          (milestone) =>
            milestone.id === pickedId &&
            milestone.areaId === (target?.id ?? null) &&
            milestone.projectId === projectId,
        ) ?? null)
      : null;
  const tab = tabs.find((each) => each.key === scope);
  const none =
    mineOnly && (placed.length > 0 || !scope)
      ? 'Dir ist hier keine Aufgabe zugeteilt.'
      : scope === OWN_SCOPE && !placeProjects.length
        ? 'Du hast noch keine eigene Aufgabe.'
        : `In „${project ? project.name : own ? DEFAULT_PROJECT_NAME : scope === WORKSPACE_SCOPE ? (target?.name ?? 'Workspace') : (tab?.label ?? '')}“ steht noch keine Aufgabe.`;
  const tiles = view === 'tiles';
  const rows = (each: readonly Todo[]) =>
    each.map((todo) =>
      tiles ? (
        <TodoCard
          key={todo.id}
          todo={todo}
          open={shown.id === todo.id}
          onToggle={() => shown.toggle(todo.id)}
        />
      ) : (
        <TodoRow
          key={todo.id}
          todo={todo}
          open={shown.id === todo.id}
          onToggle={() => shown.toggle(todo.id)}
        />
      ),
    );
  return (
    <div className="flex w-full flex-col gap-6 pb-16">
      {/* A place's projects: its „Allgemein“ and those made beside it, one open. */}
      {projectPlace && placeProjects.length > 0 && (
        <ProjectTabs own={own} projects={placeProjects} current={project} onPick={setProject} />
      )}
      {/* The new one's field, the search and tiles or rows: one line, as on „Agenten“. */}
      {(canAdd || all.length > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {/* On a phone the new to-do takes its own row, search and view under it. */}
          <div className="min-w-48 flex-1 max-sm:basis-full">
            {canAdd && <NewTodo areaId={target?.id ?? null} project={project} milestone={picked} />}
          </div>
          {/* Between the new to-do and the search: a new project, typed where it stands. */}
          {canAdd && projectPlace && <NewProject areaId={target?.id ?? null} onMade={setProject} />}
          {/* The search on the right, in the row – as Post's. */}
          {all.length > 0 && (
            <ViewSearch
              label="Aufgaben durchsuchen"
              value={query}
              onChange={setQuery}
              className="min-w-36 shrink max-sm:flex-1"
            />
          )}
          {all.length > 0 && <TodoViewToggle view={view} onChange={setView} />}
        </div>
      )}
      {/* Nothing to show: as on „Dateien“ and „Agenten“ – the picture, what it means, what to do. */}
      {(scope || mineOnly) && scoped.length === 0 ? (
        <Empty
          icon="checklist"
          title={mineOnly ? 'Nichts zugeteilt' : 'Noch keine Aufgabe'}
          message={none}
        />
      ) : scoped.length > 0 && list.length === 0 ? (
        <Empty
          icon="search"
          title={`Keine Treffer für „${query.trim()}“`}
          message="Gesucht wird im Titel, in der Beschreibung und nach wem sie gegeben ist."
        />
      ) : list.length === 0 ? (
        <Empty
          icon="checklist"
          title="Noch keine Aufgabe"
          message={
            !area
              ? 'Deine und die aus deinen Bereichen stehen hier.'
              : canAdd
                ? `Schreib oben, was in ${project ? 'diesem Projekt' : 'diesem Bereich'} zu tun ist.`
                : `Hier stehen die Aufgaben ${project ? 'dieses Projekts' : 'dieses Bereichs'}.`
          }
        />
      ) : view === 'timeline' ? (
        // On a timeline, under their milestones – the place's, area and project (on „Alle“ every
        // place's).
        <TodoTimeline
          todos={list}
          milestones={shownMilestones}
          openId={shown.id}
          onToggle={shown.toggle}
          newIn={canAdd ? { areaId: target?.id ?? null, projectId } : undefined}
          picked={picked?.id ?? null}
          onPick={setPicked}
          lead={
            area || scope
              ? undefined
              : (areaId) => {
                  const place = areas.find((each) => each.id === areaId);
                  return place ? <AreaDot color={place.color} /> : <MeAvatar />;
                }
          }
        />
      ) : area || scope ? (
        // One place – an area or a tab of the overview: by status, as a project's plan.
        BY_STATUS.map((status) => {
          const here = list.filter((todo) => todo.status === status);
          if (here.length === 0) return null;
          return (
            <Group
              key={status}
              lead={<StatusMark status={status} />}
              title={TODO_STATUS_LABELS[status]}
              count={here.length}
              folded={!isOpenTodo(status)}
              tiles={tiles}
            >
              {rows(here)}
            </Group>
          );
        })
      ) : (
        <Overview list={list} projects={projects.data ?? []} rows={rows} tiles={tiles} />
      )}
    </div>
  );
}

/** The to-dos a page's search finds: every word in the title, the description or whose it is. */
function todosSaying(todos: readonly Todo[], query: string) {
  const words = searchFold(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return todos;
  return todos.filter((todo) => {
    const hay = searchFold(
      `${todo.title} ${todo.description} ${todo.assignee?.name ?? ''} ${todo.assigneeAgent?.title ?? ''}`,
    );
    return words.every((word) => hay.includes(word));
  });
}

/**
 * „Deine Aufgaben“ on „Zuletzt“: the few most pressing of one's own and those given to one, each
 * changed where it stands as in the list; there only while there is some.
 */
export function MyTodos({ shown = 5 }: { shown?: number }) {
  const ui = useCloud();
  const todos = useTodos(ui.workspace.id);
  const panel = useShownTodo();
  const mine = (todos.data ?? []).filter((todo) => isMine(todo, ui.userId)).sort(byUrgency);
  if (mine.length === 0) return null;
  return (
    <section aria-labelledby="cloud-todos" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="cloud-todos" className="text-base font-semibold text-fg">
          Deine Aufgaben
        </h2>
        <TextLink to={routes.cloudTodos(ui.workspace.id)} size="body">
          {mine.length > shown ? `Alle ${mine.length}` : 'Alle Aufgaben'}
        </TextLink>
      </div>
      <ul className="flex flex-col">
        {mine.slice(0, shown).map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            open={panel.id === todo.id}
            onToggle={() => panel.toggle(todo.id)}
            showPlace
          />
        ))}
      </ul>
    </section>
  );
}

/** The to-do open in the side panel (`?aufgabe=`); clicked again, it closes. */
export function useShownTodo() {
  const [params, setParams] = useSearchParams();
  const id = params.get(CLOUD_TODO_PARAM);
  const set = (next: string | null, replace = false) =>
    setParams(
      (current) => {
        const after = new URLSearchParams(current);
        if (next) after.set(CLOUD_TODO_PARAM, next);
        else after.delete(CLOUD_TODO_PARAM);
        // One panel beside the page: a file's details or an event make way.
        after.delete(CLOUD_FILE_PARAM);
        after.delete(CLOUD_EVENT_PARAM);
        after.delete(CLOUD_CALL_PARAM);
        return after;
      },
      { replace },
    );
  return { id, toggle: (todoId: string) => set(id === todoId ? null : todoId), close: set };
}

/**
 * A to-do in the side panel beside the page, as a file's details (`Preview`): its words typed in
 * place, its properties under them. Esc or ✕ closes it; the list stays where it was.
 */
export function TodoPanel() {
  const ui = useCloud();
  const shown = useShownTodo();
  const todos = useTodos(ui.workspace.id, null, shown.id !== null);
  const todo = todos.data?.find((each) => each.id === shown.id) ?? null;
  const change = useChange(todo);
  const missing = shown.id !== null && todos.data !== undefined && !todo;
  useEffect(() => {
    // Deleted (here or by someone else) or never seen: nothing to show.
    if (missing) shown.close(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it is gone
  }, [missing]);
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!shown.id || event.key !== 'Escape' || event.defaultPrevented) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    shown.close(null);
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  if (!shown.id || !todo) return null;
  return (
    <SidePanel aria-label={`Aufgabe #${todo.number}`} data-cloud-panel>
      <TodoDetail key={todo.id} todo={todo} onChange={change} onClose={() => shown.close(null)} />
    </SidePanel>
  );
}

/** Rows (Linear's), tiles (as agents') or a timeline („Zeitplan“): remembered in this browser. */
const TODO_VIEWS = ['list', 'tiles', 'timeline'] as const;
type TodoView = (typeof TODO_VIEWS)[number];

/** As agents' toggle (`AgentViewToggle`), with the timeline beside rows and tiles. */
function TodoViewToggle({
  view,
  onChange,
}: {
  view: TodoView;
  onChange: (view: TodoView) => void;
}) {
  const views: [TodoView, 'gridView' | 'viewList' | 'viewTimeline', string][] = [
    ['tiles', 'gridView', 'Kachelansicht'],
    ['list', 'viewList', 'Listenansicht'],
    ['timeline', 'viewTimeline', 'Zeitplan'],
  ];
  return (
    <Toolbar role="group" label="Ansicht" className="ml-auto shrink-0">
      {views.map(([key, icon, label]) => (
        <IconButton
          key={key}
          icon={icon}
          label={label}
          size="sm"
          iconSize={18}
          active={view === key}
          onClick={() => onChange(key)}
        />
      ))}
    </Toolbar>
  );
}
/**
 * „Mir zugeteilt“ on the right of „Aufgaben“'s title, as Post's „Ungelesen“: on, only those
 * given to oneself show – on every tab.
 */
export function AssignedFilter() {
  const narrow = useMediaQuery('(max-width: 639px)');
  const [on, set] = useAssignedOnly();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="person"
      aria-pressed={on}
      title={on ? 'Nur mir zugeteilte – alle zeigen' : 'Nur mir zugeteilte zeigen'}
      className="aria-pressed:bg-selected aria-pressed:text-fg"
      onClick={() => set(!on)}
    >
      <span className={cn(narrow && 'sr-only')}>Mir zugeteilt</span>
    </Button>
  );
}

/** The overview's tabs (`ScopeTabs`) and the open one – as „Agenten“'s. */
export function useTodoScope() {
  const ui = useCloud();
  return scopeTabs(ui.home?.areas ?? [], useScope(), {
    own: 'Nur du siehst sie',
    workspace: 'Alle im Workspace sehen sie',
  });
}

/** Linear's order of the groups: what is under way first, the finished last. */
const BY_STATUS = ['in_progress', 'todo', 'backlog', 'done', 'canceled'] as const;

/** One's own first, then each area – the open ones, the finished folded under them. */
function Overview({
  list,
  projects,
  rows,
  tiles,
}: {
  list: readonly Todo[];
  projects: readonly TodoProject[];
  rows: (each: readonly Todo[]) => ReactNode;
  tiles: boolean;
}) {
  const ui = useCloud();
  const areas = ui.home?.areas ?? [];
  const places: { key: string; title: string; lead: ReactNode; todos: Todo[] }[] = [];
  // Each place's „Allgemein“ under its name, then each of its projects as „Bereich | Projekt“ –
  // one's own first.
  const order = (id: string) => {
    const at = projects.findIndex((each) => each.id === id);
    return at < 0 ? projects.length : at;
  };
  const place = (key: string, title: string, lead: ReactNode, here: Todo[]) => {
    const general = here.filter((todo) => !todo.project);
    if (general.length) places.push({ key, title, lead, todos: general });
    const inProjects = [
      ...new Map(here.flatMap((todo) => (todo.project ? [[todo.project.id, todo.project]] : []))),
    ]
      .map(([, each]) => each)
      .sort((a, b) => order(a.id) - order(b.id));
    for (const each of inProjects) {
      places.push({
        key: each.id,
        title: `${title} | ${each.name}`,
        lead,
        todos: here.filter((todo) => todo.project?.id === each.id),
      });
    }
  };
  place(
    'own',
    MINE,
    <MeAvatar />,
    list.filter((todo) => todo.areaId === null),
  );
  for (const area of areas) {
    place(
      area.id,
      area.name,
      <AreaDot color={area.color} />,
      list.filter((todo) => todo.areaId === area.id),
    );
  }
  return places.map((place) => {
    const open = place.todos.filter((todo) => isOpenTodo(todo.status));
    const finished = place.todos.filter((todo) => !isOpenTodo(todo.status));
    return (
      <Group
        key={place.key}
        lead={place.lead}
        title={place.title}
        count={open.length}
        tiles={tiles}
      >
        {rows(open)}
        {finished.length > 0 && (
          <Group nested title="Erledigt" count={finished.length} folded tiles={tiles}>
            {rows(finished)}
          </Group>
        )}
      </Group>
    );
  });
}

function Group({
  lead,
  title,
  count,
  folded = false,
  nested = false,
  tiles = false,
  children,
}: {
  lead?: ReactNode;
  title: string;
  count: number;
  folded?: boolean;
  nested?: boolean;
  /** Its to-dos as tiles side by side; a group in it spans the whole row. */
  tiles?: boolean;
  children: ReactNode;
}) {
  const [shut, setShut] = useState(folded);
  return (
    <section className={cn('flex flex-col', tiles && 'gap-2', tiles && nested && 'col-span-full')}>
      <button
        type="button"
        aria-expanded={!shut}
        onClick={() => setShut((now) => !now)}
        className={cn(
          'flex h-8 items-center gap-2 rounded-control px-3 text-left text-sm hover:bg-hover',
          nested ? 'text-fg-muted' : 'font-medium text-fg',
        )}
      >
        <Icon
          name="chevronRight"
          size="xs"
          className={cn('text-fg-faint transition-transform', !shut && 'rotate-90')}
        />
        {lead}
        <span className="truncate">{title}</span>
        <span className="text-fg-faint tabular-nums">{count}</span>
      </button>
      {!shut && <ul className={tiles ? GRID : 'flex flex-col'}>{children}</ul>}
    </section>
  );
}

/**
 * Typed where it stands: Enter puts it in – one's own in the overview, the area's in an area, in
 * the project open there; on the timeline into the milestone picked there.
 */
function NewTodo({
  areaId,
  project,
  milestone,
}: {
  areaId: string | null;
  project: TodoProject | null;
  milestone: TodoMilestone | null;
}) {
  const ui = useCloud();
  const create = useCreateTodo(ui.workspace.id);
  const [title, setTitle] = useState('');
  const add = () => {
    const text = title.trim();
    if (!text) return;
    setTitle('');
    create.mutate(
      { title: text, areaId, projectId: project?.id ?? null, milestoneId: milestone?.id ?? null },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
  };
  // The field at a page's top, as every other there (`TextField`).
  return (
    <TextField
      icon="add"
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) add();
        if (event.key === 'Escape') setTitle('');
      }}
      maxLength={300}
      placeholder={
        (project
          ? `Neue Aufgabe in „${project.name}“`
          : areaId
            ? 'Neue Aufgabe im Bereich'
            : 'Neue Aufgabe') + (milestone ? ` für „${milestone.name}“` : '')
      }
      aria-label="Neue Aufgabe"
      // Ready to type, as „Agenten“'s order field – also where „Neu › Neue Aufgabe“ leads.
      autoFocus
    />
  );
}

const dueFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const today = () => new Date().toLocaleDateString('sv-SE');
const dueLabel = (dueOn: string) => dueFormat.format(new Date(`${dueOn}T12:00:00`));

function TodoRow({
  todo,
  open,
  onToggle,
  showPlace = false,
}: {
  todo: Todo;
  open: boolean;
  onToggle: () => void;
  /** Outside its list: where it stands, an area's dot and name. */
  showPlace?: boolean;
}) {
  const change = useChange(todo);
  const ui = useCloud();
  const area = showPlace ? ui.home?.areas.find((each) => each.id === todo.areaId) : undefined;
  const overdue = todo.dueOn !== null && isOpenTodo(todo.status) && todo.dueOn < today();
  // A right click opens its menu at the pointer, as on an agent – where it has one.
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  return (
    <li onContextMenu={todo.canEdit ? onContextMenu : undefined}>
      <TodoActions todo={todo} {...contextMenu} />
      <div
        className={cn(
          'group flex h-10 items-center gap-2 rounded-control px-3 hover:bg-hover',
          open && 'bg-selected hover:bg-selected',
        )}
      >
        <span className="w-9 shrink-0 text-xs text-fg-faint tabular-nums">#{todo.number}</span>
        <StatusPicker todo={todo} onChange={change} />
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={open}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm',
            isOpenTodo(todo.status) ? 'text-fg' : 'text-fg-muted line-through decoration-fg-faint',
          )}
        >
          {todo.title}
        </button>
        {area && (
          <span className="flex max-w-40 shrink-0 items-center gap-1.5 text-xs text-fg-muted">
            <AreaDot color={area.color} />
            <span className="truncate">
              {todo.project ? `${area.name} | ${todo.project.name}` : area.name}
            </span>
          </span>
        )}
        {/* What it carries beyond its title, named on hover. */}
        {todo.description && (
          <span title="Hat eine Beschreibung" className="flex">
            <Icon name="notes" size="sm" className="text-fg-faint" />
          </span>
        )}
        {todo.source && (
          <span title="Aus einer Mail" className="flex">
            <Icon name="mail" size="sm" className="text-fg-faint" />
          </span>
        )}
        {todo.milestone && (
          <span
            title={`Meilenstein: ${todo.milestone.name}`}
            className="hidden max-w-36 shrink-0 items-center gap-1 text-xs text-fg-muted md:flex"
          >
            <Icon name="flag" size="xs" className="shrink-0 text-fg-faint" />
            <span className="truncate">{todo.milestone.name}</span>
          </span>
        )}
        {todo.dueOn && (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              overdue ? 'text-danger' : 'text-fg-muted',
            )}
          >
            {dueLabel(todo.dueOn)}
          </span>
        )}
        {/* None set: only on hover, so the right edge stays quiet. */}
        <span
          className={cn(
            'flex shrink-0',
            todo.priority === 0 &&
              'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100',
          )}
        >
          <PriorityPicker todo={todo} onChange={change} />
        </span>
        <SendAgentButton todo={todo} />
        <WhoPicker todo={todo} onChange={change} />
      </div>
    </li>
  );
}

/**
 * A to-do as a tile, as an agent's (`AgentCard`): its state, number and when it is due on top,
 * its title and the start of its words under them. A click opens it beside the page.
 */
function TodoCard({ todo, open, onToggle }: { todo: Todo; open: boolean; onToggle: () => void }) {
  const change = useChange(todo);
  const overdue = todo.dueOn !== null && isOpenTodo(todo.status) && todo.dueOn < today();
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  return (
    <li
      onContextMenu={todo.canEdit ? onContextMenu : undefined}
      className={cn(
        'group glass relative flex h-[148px] flex-col gap-2 rounded-panel p-4 transition-colors hover:bg-glass-hover',
        // A picker open on it stands over the tiles after it.
        'has-[[aria-expanded=true]]:z-(--z-raised) has-[button[data-card]:focus-visible]:ring-2 has-[button[data-card]:focus-visible]:ring-focus',
        open && 'bg-selected hover:bg-selected',
      )}
    >
      <div className="relative z-(--z-raised) -mx-1 -mt-1 flex items-center gap-1">
        <StatusPicker todo={todo} onChange={change} />
        <span className="text-xs text-fg-faint tabular-nums">#{todo.number}</span>
        <span className="flex-1" />
        {todo.source && <Icon name="mail" size="sm" className="text-fg-faint" />}
        {todo.dueOn && (
          <span
            className={cn(
              'shrink-0 px-1 text-xs tabular-nums',
              overdue ? 'text-danger' : 'text-fg-muted',
            )}
          >
            {dueLabel(todo.dueOn)}
          </span>
        )}
        <PriorityPicker todo={todo} onChange={change} />
        <SendAgentButton todo={todo} />
        <WhoPicker todo={todo} onChange={change} />
      </div>
      <button
        type="button"
        data-card
        onClick={onToggle}
        aria-pressed={open}
        className={cn(
          'line-clamp-2 text-left text-body font-medium outline-none after:absolute after:inset-0',
          isOpenTodo(todo.status) ? 'text-fg' : 'text-fg-muted line-through decoration-fg-faint',
        )}
      >
        {todo.title}
      </button>
      {todo.description && (
        <p className="line-clamp-2 text-xs leading-[17px] text-fg-muted">{todo.description}</p>
      )}
      <TodoActions todo={todo} {...contextMenu} />
    </li>
  );
}

/** A change, at once (`useUpdateTodo`); refused, a toast says why and the list is back. */
function useChange(todo: Todo | null) {
  const ui = useCloud();
  const update = useUpdateTodo(ui.workspace.id);
  return (change: TodoChange, files?: Attachment[]) =>
    todo &&
    update.mutate(
      { id: todo.id, change, files },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
}

/**
 * How pickers look in a to-do's panel: `chip` – a hairline round them (its state under the title);
 * `row` – a line across, its mark in front (its details); `card` – the agent docked at its foot,
 * its panel opening upwards. Elsewhere (`plain`) they sit small in a row of the list.
 */
type PickerLookKind = 'plain' | 'chip' | 'row' | 'card';
const PickerLook = createContext<PickerLookKind>('plain');

/** A property's choice in a small panel beside it, closed on pick – Linear's pickers. */
export function Picker({
  label,
  trigger,
  disabled,
  wide = false,
  calendar = false,
  fluid = false,
  className,
  children,
}: {
  label: string;
  trigger: ReactNode;
  disabled: boolean;
  wide?: boolean;
  /** Narrows with its line, its words cut short („…“) – a long agent's name. */
  fluid?: boolean;
  /** A month to pick a day from: a dialog, wide enough for a week. */
  calendar?: boolean;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { open, close, wrapperRef, panelId, triggerProps } = usePopover({
    hasPopup: calendar ? 'dialog' : 'menu',
  });
  const look = useContext(PickerLook);
  const across = look === 'row' || look === 'card';
  return (
    <div
      ref={wrapperRef}
      className={cn('relative flex', across ? 'w-full' : fluid ? 'min-w-0' : 'shrink-0')}
    >
      <button
        type="button"
        {...triggerProps}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={cn(
          'flex items-center text-sm',
          {
            plain: 'h-7 gap-1.5 rounded-control-sm px-1',
            chip: 'h-7 gap-1.5 rounded-full border border-hairline pr-2.5 pl-1.5',
            row: 'h-9 w-full min-w-0 gap-2.5 rounded-control px-2',
            card: 'min-h-12 w-full min-w-0 gap-3 rounded-control px-2 py-1.5 text-left',
          }[look],
          fluid && 'min-w-0',
          disabled ? 'cursor-default' : 'hover:bg-hover aria-expanded:bg-hover',
          className,
        )}
      >
        {trigger}
      </button>
      {open && (
        <PopoverPanel
          id={panelId}
          padding="md"
          side={look === 'card' ? 'top' : 'bottom'}
          role={calendar ? 'dialog' : 'menu'}
          aria-label={calendar ? label : undefined}
          className={calendar ? 'w-72' : wide ? 'w-64' : 'w-52'}
        >
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  );
}

function StatusPicker({
  todo,
  onChange,
  labelled = false,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
  labelled?: boolean;
}) {
  return (
    <Picker
      label={`Status: ${TODO_STATUS_LABELS[todo.status]}`}
      disabled={!todo.canEdit}
      trigger={
        <>
          <StatusMark status={todo.status} />
          {labelled && <span>{TODO_STATUS_LABELS[todo.status]}</span>}
        </>
      }
    >
      {(close) =>
        TODO_STATUSES.map((status) => (
          <MenuItem
            key={status}
            role="menuitemradio"
            aria-checked={todo.status === status}
            icon={<StatusMark status={status} />}
            selected={todo.status === status}
            onClick={() => {
              close();
              if (status !== todo.status) onChange({ status });
            }}
          >
            {TODO_STATUS_LABELS[status]}
          </MenuItem>
        ))
      }
    </Picker>
  );
}

function PriorityPicker({
  todo,
  onChange,
  labelled = false,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
  labelled?: boolean;
}) {
  // None first, then urgent down to low.
  return (
    <Picker
      label={`Priorität: ${TODO_PRIORITY_LABELS[todo.priority]}`}
      disabled={!todo.canEdit}
      trigger={
        <>
          <PriorityMark priority={todo.priority} />
          {labelled && <span>{TODO_PRIORITY_LABELS[todo.priority]}</span>}
        </>
      }
    >
      {(close) =>
        TODO_PRIORITIES.map((priority) => (
          <MenuItem
            key={priority}
            role="menuitemradio"
            aria-checked={todo.priority === priority}
            icon={<PriorityMark priority={priority} />}
            selected={todo.priority === priority}
            onClick={() => {
              close();
              if (priority !== todo.priority) onChange({ priority });
            }}
          >
            {TODO_PRIORITY_LABELS[priority]}
          </MenuItem>
        ))
      }
    </Picker>
  );
}

/** Who may do it: oneself on one's own; on an area's, whoever sees the area. */
function peopleFor(
  todo: Todo,
  people: readonly CloudPerson[],
  area: CloudArea | undefined,
  me: string,
) {
  if (!todo.areaId) return people.filter((person) => person.id === me);
  if (!area || area.visibility === 'workspace') return people;
  const members = new Set(area.members.map((member) => member.id));
  return people.filter((person) => members.has(person.id) || person.role === 'admin');
}

/**
 * Which agent may be sent: on one's own, one's own private agent (others would read along in a
 * shared one's chat); on an area's, also one shared in that very area.
 */
const agentsFor = (todo: Todo, agents: readonly CloudAgentSummary[]) =>
  agents.filter((agent) =>
    agent.shared ? todo.areaId !== null && agent.areaId === todo.areaId : agent.mine,
  );

/**
 * Sends the agent given it on it (`useSendTodoAgent`) – given and sent are two steps, so who
 * does what can be planned first; refused (no AI, busy), a toast says why.
 */
function useSendAgent(todo: Todo) {
  const ui = useCloud();
  const send = useSendTodoAgent(ui.workspace.id);
  return () =>
    send.mutate(todo.id, {
      onSuccess: () =>
        ui.notify(`${todo.assigneeAgent?.title ?? 'Agent'} arbeitet an #${todo.number}`),
      onError: (error) => ui.notify(error.message, 'danger'),
    });
}

/**
 * The agent given it, as the agents' list knows it: whether it works now, and whether one may
 * send it (`agentsFor`) and it is free to start.
 */
function useTodoAgent(todo: Todo) {
  const ui = useCloud();
  const agents = useCloudAgents(ui.workspace.id).data ?? [];
  const agent = todo.assigneeAgent
    ? agentsFor(todo, agents).find((each) => each.id === todo.assigneeAgent?.id)
    : undefined;
  const working = todo.assigneeAgent
    ? (agents.find((each) => each.id === todo.assigneeAgent?.id)?.running ?? false)
    : false;
  return { working, sendable: todo.canEdit && !!agent && !working };
}

/** „Losschicken“ beside the agent in a row or tile – only while the agent given it waits. */
function SendAgentButton({ todo }: { todo: Todo }) {
  const { sendable } = useTodoAgent(todo);
  const send = useSendAgent(todo);
  if (!sendable) return null;
  return (
    <IconButton
      icon="send"
      label={`${todo.assigneeAgent?.title ?? 'Agent'} losschicken`}
      size="compact"
      iconSize={16}
      onClick={send}
    />
  );
}

/**
 * The one doing it – a person, an agent given it, or both; the agent's face pulses while it
 * works. Picking an agent only gives it the to-do; „Losschicken“ starts it. `part`: only the
 * person or only the agent, named – the to-do's panel has a line for each.
 */
function WhoPicker({
  todo,
  onChange,
  part,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
  part?: 'person' | 'agent';
}) {
  const showPerson = part !== 'agent';
  const showAgent = part !== 'person';
  const ui = useCloud();
  const people = useCloudPeople(ui.workspace.id).data ?? [];
  const agents = useCloudAgents(ui.workspace.id).data ?? [];
  const area = ui.home?.areas.find((each) => each.id === todo.areaId);
  const { working, sendable: canSend } = useTodoAgent(todo);
  const send = useSendAgent(todo);
  const newAgent = useNewTodoAgent(ui.workspace.id);
  const makes = canCreateDecks(ui.workspace.role);
  const look = useContext(PickerLook);
  const label = [
    showPerson && todo.assignee ? todo.assignee.name : null,
    showAgent && todo.assigneeAgent
      ? `${todo.assigneeAgent.title}${working ? ' arbeitet daran' : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');
  const candidates = peopleFor(todo, people, area, ui.userId);
  const sendable = agentsFor(todo, agents);
  const agentLine = showAgent && (makes || sendable.length > 0);
  if (part === 'agent' && !agentLine && !todo.assigneeAgent) return null;
  const nobody = part === 'agent' ? 'Kein Agent' : 'Zuständig';
  // Docked as a card: the agent's face larger, how it stands under its name.
  const card = look === 'card' && part === 'agent';
  const state = working
    ? 'Arbeitet daran'
    : todo.assigneeAgent
      ? canSend
        ? 'Wartet aufs Losschicken'
        : 'Zugeteilt'
      : 'Einen Agenten zuteilen';
  return (
    <Picker
      wide
      fluid={!!part}
      label={
        label
          ? `${part === 'agent' ? 'Agent' : 'Zuständig'}: ${label}`
          : `${part === 'agent' ? 'Agent' : 'Zuständig'}: ${nobody.toLowerCase()}`
      }
      disabled={!todo.canEdit}
      className={part && !label && !card ? 'text-fg-muted' : undefined}
      trigger={
        card ? (
          <>
            {todo.assigneeAgent ? (
              <span className="relative flex shrink-0 rounded-control">
                <AgentAvatar id={todo.assigneeAgent.id} size={32} />
                {working && (
                  <span className="absolute -right-0.5 -bottom-0.5 size-2.5 animate-pulse rounded-full bg-success ring-2 ring-canvas" />
                )}
              </span>
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-fg-faint text-fg-faint">
                <Icon name="autoAwesome" size="md" />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate font-medium', !todo.assigneeAgent && 'text-fg-muted')}>
                {todo.assigneeAgent?.title ?? nobody}
              </span>
              <span className={cn('truncate text-xs', working ? 'text-success' : 'text-fg-subtle')}>
                {state}
              </span>
            </span>
            {todo.canEdit && (
              <Icon name="expandMore" size="md" className="shrink-0 text-fg-subtle" />
            )}
          </>
        ) : (
          <>
            <span className="flex shrink-0 items-center -space-x-1">
              {showAgent && todo.assigneeAgent && (
                <span className="relative flex rounded-control">
                  <AgentAvatar id={todo.assigneeAgent.id} size={20} />
                  {working && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2 animate-pulse rounded-full bg-success ring-2 ring-canvas" />
                  )}
                </span>
              )}
              {showPerson && todo.assignee && (
                <Avatar author={todo.assignee} size={20} nativeTitle={false} />
              )}
              {!label && (
                <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-fg-faint text-fg-faint">
                  <Icon name={part === 'agent' ? 'autoAwesome' : 'person'} size={12} />
                </span>
              )}
            </span>
            {part && <span className="truncate">{label || nobody}</span>}
          </>
        )
      }
    >
      {(close) => (
        <>
          {showPerson && (
            <>
              {!part && <MenuHeading>Person</MenuHeading>}
              <MenuItem
                role="menuitemradio"
                aria-checked={!todo.assignee}
                selected={!todo.assignee}
                icon="personRemove"
                onClick={() => {
                  close();
                  if (todo.assignee) onChange({ assigneeId: null });
                }}
              >
                Niemand
              </MenuItem>
              {candidates.map((person) => (
                <MenuItem
                  key={person.id}
                  role="menuitemradio"
                  aria-checked={todo.assignee?.id === person.id}
                  selected={todo.assignee?.id === person.id}
                  icon={<Avatar author={person} size={18} nativeTitle={false} />}
                  truncate
                  onClick={() => {
                    close();
                    if (todo.assignee?.id !== person.id) onChange({ assigneeId: person.id });
                  }}
                >
                  {person.id === ui.userId ? `${person.name} (du)` : person.name}
                </MenuItem>
              ))}
            </>
          )}
          {agentLine && (
            <>
              {!part && (
                <>
                  <MenuDivider />
                  <MenuHeading>Agent</MenuHeading>
                </>
              )}
              {makes && (
                <MenuItem
                  role="menuitem"
                  icon="autoAwesome"
                  onClick={() => {
                    close();
                    newAgent.mutate(todo.id, {
                      onError: (error) => ui.notify(error.message, 'danger'),
                    });
                  }}
                >
                  Neuer Agent
                </MenuItem>
              )}
              {todo.assigneeAgent && (
                <MenuItem
                  role="menuitem"
                  icon="close"
                  onClick={() => {
                    close();
                    onChange({ assigneeAgentId: null });
                  }}
                >
                  Kein Agent
                </MenuItem>
              )}
              {sendable.map((agent) => (
                <MenuItem
                  key={agent.id}
                  role="menuitemradio"
                  aria-checked={todo.assigneeAgent?.id === agent.id}
                  selected={todo.assigneeAgent?.id === agent.id}
                  icon={<AgentAvatar id={agent.id} size={18} />}
                  truncate
                  onClick={() => {
                    close();
                    if (todo.assigneeAgent?.id !== agent.id)
                      onChange({ assigneeAgentId: agent.id });
                  }}
                >
                  {agent.title}
                </MenuItem>
              ))}
              {canSend && (
                <>
                  <MenuDivider />
                  <MenuItem
                    role="menuitem"
                    icon="send"
                    onClick={() => {
                      close();
                      send();
                    }}
                  >
                    Losschicken
                  </MenuItem>
                </>
              )}
            </>
          )}
        </>
      )}
    </Picker>
  );
}

/** A date picked with the system's own calendar; „Kein Datum“ takes it back. */
function DuePicker({ todo, onChange }: { todo: Todo; onChange: (change: TodoChange) => void }) {
  const overdue = todo.dueOn !== null && isOpenTodo(todo.status) && todo.dueOn < today();
  return (
    <Picker
      calendar
      label={todo.dueOn ? `Fällig am ${dueLabel(todo.dueOn)}` : 'Fällig am'}
      disabled={!todo.canEdit}
      className={overdue ? 'text-danger' : todo.dueOn ? 'text-fg' : 'text-fg-muted'}
      trigger={
        <>
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="schedule" size="md" />
          </span>
          {todo.dueOn ? dueLabel(todo.dueOn) : 'Fällig am'}
        </>
      }
    >
      {(close) => (
        <DueCalendar
          value={todo.dueOn}
          onPick={(dueOn) => {
            close();
            if (dueOn !== todo.dueOn) onChange({ dueOn });
          }}
        />
      )}
    </Picker>
  );
}

/** When work on it begins – its bar's start on the timeline. */
function StartPicker({ todo, onChange }: { todo: Todo; onChange: (change: TodoChange) => void }) {
  return (
    <Picker
      calendar
      label={todo.startOn ? `Beginn am ${dueLabel(todo.startOn)}` : 'Beginn'}
      disabled={!todo.canEdit}
      className={todo.startOn ? 'text-fg' : 'text-fg-muted'}
      trigger={
        <>
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="event" size="md" />
          </span>
          {todo.startOn ? `Ab ${dueLabel(todo.startOn)}` : 'Beginn'}
        </>
      }
    >
      {(close) => (
        <DueCalendar
          value={todo.startOn}
          onPick={(startOn) => {
            close();
            if (startOn !== todo.startOn) onChange({ startOn });
          }}
        />
      )}
    </Picker>
  );
}

/**
 * The milestone it leads to: one of its place's, or a new one typed where it stands at the foot
 * of the choice – made and given at once.
 */
function MilestonePicker({
  todo,
  onChange,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
}) {
  const ui = useCloud();
  const here = (useMilestones(ui.workspace.id).data ?? []).filter(
    (milestone) =>
      milestone.areaId === todo.areaId && milestone.projectId === (todo.project?.id ?? null),
  );
  const create = useCreateMilestone(ui.workspace.id);
  const [name, setName] = useState('');
  return (
    <Picker
      wide
      label={todo.milestone ? `Meilenstein: ${todo.milestone.name}` : 'Meilenstein'}
      disabled={!todo.canEdit}
      className={todo.milestone ? 'text-fg' : 'text-fg-muted'}
      trigger={
        <>
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="flag" size="md" />
          </span>
          <span className="truncate">{todo.milestone?.name ?? 'Meilenstein'}</span>
          {todo.milestone?.dueOn && (
            <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
              {dueLabel(todo.milestone.dueOn)}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <>
          {todo.milestone && (
            <MenuItem
              onClick={() => {
                close();
                onChange({ milestoneId: null });
              }}
            >
              Kein Meilenstein
            </MenuItem>
          )}
          {here.map((milestone) => (
            <MenuItem
              key={milestone.id}
              role="menuitemradio"
              aria-checked={todo.milestone?.id === milestone.id}
              selected={todo.milestone?.id === milestone.id}
              icon="flag"
              truncate
              trailing={
                milestone.dueOn && (
                  <span className="text-xs text-fg-subtle tabular-nums">
                    {dueLabel(milestone.dueOn)}
                  </span>
                )
              }
              onClick={() => {
                close();
                if (todo.milestone?.id !== milestone.id) onChange({ milestoneId: milestone.id });
              }}
            >
              {milestone.name}
            </MenuItem>
          ))}
          {(todo.milestone || here.length > 0) && <MenuDivider />}
          <label className="flex h-8 items-center gap-2 px-2 text-sm">
            <Icon name="add" size="sm" className="shrink-0 text-fg-subtle" />
            <input
              value={name}
              maxLength={MAX_MILESTONE_NAME}
              placeholder="Neuer Meilenstein …"
              aria-label="Neuer Meilenstein"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                // Typed letters stay in the field; Esc closes the picker as anywhere in it.
                if (event.key !== 'Escape') event.stopPropagation();
                if (event.key !== 'Enter' || !name.trim()) return;
                const text = name.trim();
                setName('');
                close();
                create
                  .mutateAsync({
                    name: text,
                    areaId: todo.areaId,
                    projectId: todo.project?.id ?? null,
                  })
                  .then(
                    (made) => onChange({ milestoneId: made.id }),
                    (error: Error) => ui.notify(error.message, 'danger'),
                  );
              }}
              className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
            />
          </label>
        </>
      )}
    </Picker>
  );
}

/**
 * „Wartet auf“: the to-dos of its place it is to start after – picked one by one (a pick adds or
 * takes one away and closes, as every picker); those waiting on it already are not offered (a
 * loop never ends). Under it, which wait on it. The timeline marks red one that starts too early.
 */
function BlockedByPicker({
  todo,
  onChange,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
}) {
  const ui = useCloud();
  const all = useTodos(ui.workspace.id).data ?? [];
  const [query, setQuery] = useState('');
  const here = all.filter(
    (each) =>
      each.areaId === todo.areaId && (each.project?.id ?? null) === (todo.project?.id ?? null),
  );
  const byId = new Map(here.map((each) => [each.id, each]));
  const blockers = todo.blockedBy
    .flatMap((id) => byId.get(id) ?? [])
    .sort((a, b) => a.number - b.number);
  const waiting = heldUpBy(here, todo.id);
  const waitingOn = here.filter((each) => each.blockedBy.includes(todo.id));
  const words = searchFold(query.trim()).split(/\s+/).filter(Boolean);
  const offered = here
    .filter(
      (each) =>
        each.id !== todo.id &&
        !waiting.has(each.id) &&
        (todo.blockedBy.includes(each.id) || isOpenTodo(each.status)),
    )
    .filter((each) => {
      const hay = searchFold(`#${each.number} ${each.title}`);
      return words.every((word) => hay.includes(word));
    })
    .sort(
      (a, b) =>
        Number(todo.blockedBy.includes(b.id)) - Number(todo.blockedBy.includes(a.id)) ||
        a.number - b.number,
    );
  const names = blockers.map((each) => `#${each.number}`).join(', ');
  /** One more to wait on, or one less – the picker closes, as every picker. */
  const pick = (each: Todo, close: () => void) => {
    close();
    setQuery('');
    const picked = todo.blockedBy.includes(each.id);
    onChange({
      blockedBy: picked
        ? todo.blockedBy.filter((id) => id !== each.id)
        : [...todo.blockedBy, each.id],
    });
  };
  return (
    <>
      <Picker
        wide
        label={blockers.length ? `Wartet auf ${names}` : 'Wartet auf'}
        disabled={!todo.canEdit}
        className={blockers.length ? 'text-fg' : 'text-fg-muted'}
        trigger={
          <>
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Icon name="link" size="md" />
            </span>
            <span className="truncate">
              {blockers.length === 1
                ? `Wartet auf #${blockers[0]!.number} ${blockers[0]!.title}`
                : blockers.length
                  ? `Wartet auf ${names}`
                  : 'Wartet auf'}
            </span>
          </>
        }
      >
        {(close) => (
          <>
            {here.length > 9 && (
              <label className="flex h-8 items-center gap-2 px-2 text-sm">
                <Icon name="search" size="sm" className="shrink-0 text-fg-subtle" />
                <input
                  autoFocus
                  value={query}
                  placeholder="Aufgabe suchen …"
                  aria-label="Aufgabe suchen"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Typed letters stay in the field; Esc closes the picker, the arrows and ⇥
                    // step into the hits as anywhere in it; Enter picks the first.
                    if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key))
                      event.stopPropagation();
                    if (event.key !== 'Enter' || !offered[0]) return;
                    event.preventDefault();
                    pick(offered[0], close);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
                />
              </label>
            )}
            {offered.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-fg-muted">
                {words.length ? 'Keine Treffer' : 'Keine andere offene Aufgabe hier'}
              </p>
            ) : (
              offered.map((each) => {
                const picked = todo.blockedBy.includes(each.id);
                return (
                  <MenuItem
                    key={each.id}
                    role="menuitemcheckbox"
                    aria-checked={picked}
                    selected={picked}
                    truncate
                    trailing={
                      <span className="text-xs text-fg-faint tabular-nums">#{each.number}</span>
                    }
                    onClick={() => pick(each, close)}
                  >
                    {each.title}
                  </MenuItem>
                );
              })
            )}
          </>
        )}
      </Picker>
      {waitingOn.length > 0 && (
        <p className="flex h-9 min-w-0 items-center gap-2.5 px-2 text-sm text-fg-muted">
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="arrowForward" size="md" />
          </span>
          <span className="truncate">
            {waitingOn.map((each) => `#${each.number}`).join(', ')}{' '}
            {waitingOn.length === 1 ? 'wartet' : 'warten'} darauf
          </span>
        </p>
      )}
    </>
  );
}

/**
 * A place's projects as tabs over its list: „Allgemein“ (its to-dos without a project) and those
 * made beside it, one open. The open one's menu renames it (typed where it stands) or deletes it.
 */
function ProjectTabs({
  own,
  projects,
  current,
  onPick,
}: {
  /** One's own (on „Meine“) – not an area's. */
  own: boolean;
  projects: readonly TodoProject[];
  current: TodoProject | null;
  onPick: (projectId: string | null) => void;
}) {
  const ui = useCloud();
  const rename = useUpdateProject(ui.workspace.id);
  const remove = useDeleteProject(ui.workspace.id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<TodoProject | null>(null);
  // Esc drops what was typed – the blur that follows saves nothing.
  const dropped = useRef(false);
  const start = () => {
    dropped.current = false;
    setName(current?.name ?? '');
    setRenaming(true);
  };
  // Kept on Enter and on leaving the field, as a milestone's name.
  const save = () => {
    const text = name.trim();
    setRenaming(false);
    if (dropped.current || !text || !current || text === current.name) return;
    rename.mutate(
      { id: current.id, change: { name: text } },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
  };
  return (
    <div className="-mb-2 flex min-w-0 flex-wrap items-center gap-2">
      {!renaming && (
        <SegmentedControl
          label="Projekte"
          mode="tabs"
          size="sm"
          track="soft"
          segments={[
            { value: '', label: DEFAULT_PROJECT_NAME },
            ...projects.map((each) => ({ value: each.id, label: each.name })),
          ]}
          value={current?.id ?? ''}
          onChange={(value) => onPick(value || null)}
          className="max-w-full overflow-x-auto [scrollbar-width:none]"
        />
      )}
      {current?.canEdit && !renaming && (
        <Menu
          label={`Mehr zu „${current.name}“`}
          triggerSize="xs"
          actions={[
            { label: 'Umbenennen', icon: 'driveFileRename', onSelect: start },
            {
              label: 'Löschen',
              icon: 'delete',
              tone: 'danger' as const,
              onSelect: () => setDeleting(current),
            },
          ]}
        />
      )}
      {renaming && (
        <input
          autoFocus
          value={name}
          maxLength={MAX_PROJECT_NAME}
          aria-label="Name des Projekts"
          onChange={(event) => setName(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
              // Put in: the blur as the field goes keeps nothing more.
              dropped.current = true;
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              dropped.current = true;
              setRenaming(false);
            }
          }}
          className="h-9 w-56 rounded-control bg-surface-1 px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title={`„${deleting.name}“ löschen?`}
          description={`Seine Aufgaben und Meilensteine bleiben ${own ? 'bei dir' : 'im Bereich'}, unter „${DEFAULT_PROJECT_NAME}“.`}
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            const gone = deleting;
            setDeleting(null);
            onPick(null);
            remove.mutateAsync(gone.id).then(
              () => ui.notify(`„${gone.name}“ gelöscht`),
              (error: Error) => ui.notify(error.message, 'danger'),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * „Neues Projekt“ in the list's tool row, between the new to-do and the search: typed where it
 * stands, made on Enter (Esc or leaving the field drops it, as a new milestone) and opened.
 */
function NewProject({
  areaId,
  onMade,
}: {
  areaId: string | null;
  onMade: (projectId: string) => void;
}) {
  const ui = useCloud();
  const create = useCreateProject(ui.workspace.id);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const stop = () => {
    setTyping(false);
    setName('');
  };
  if (!typing)
    return (
      <Button
        variant="ghost"
        icon="add"
        aria-label="Neues Projekt"
        onClick={() => setTyping(true)}
        className="shrink-0"
      >
        {/* On a phone only its plus, so search and view keep one row. */}
        <span className="max-sm:hidden">Neues Projekt</span>
      </Button>
    );
  return (
    <input
      autoFocus
      value={name}
      maxLength={MAX_PROJECT_NAME}
      placeholder="Neues Projekt …"
      aria-label="Neues Projekt"
      onChange={(event) => setName(event.target.value)}
      onBlur={stop}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          stop();
        }
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        const text = name.trim();
        stop();
        if (!text) return;
        create.mutateAsync({ name: text, areaId }).then(
          (made) => onMade(made.id),
          (error: Error) => ui.notify(error.message, 'danger'),
        );
      }}
      className="h-10 w-44 shrink-0 rounded-panel border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-focus"
    />
  );
}

/**
 * Its project in its place: „Allgemein“ or one of the area's – or a new one typed where it stands
 * at the foot of the choice, made and given at once (as a milestone).
 */
function ProjectPicker({ todo, onChange }: { todo: Todo; onChange: (change: TodoChange) => void }) {
  const ui = useCloud();
  const projects = (useProjects(ui.workspace.id, todo.areaId).data ?? []).filter(
    (each) => each.areaId === todo.areaId,
  );
  const create = useCreateProject(ui.workspace.id);
  const [name, setName] = useState('');
  const label = todo.project?.name ?? DEFAULT_PROJECT_NAME;
  return (
    <Picker
      wide
      label={`Projekt: ${label}`}
      disabled={!todo.canEdit}
      trigger={
        <>
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="dashboard" size="md" />
          </span>
          <span className="truncate">{label}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem
            role="menuitemradio"
            aria-checked={!todo.project}
            selected={!todo.project}
            icon="dashboard"
            onClick={() => {
              close();
              if (todo.project) onChange({ projectId: null });
            }}
          >
            {DEFAULT_PROJECT_NAME}
          </MenuItem>
          {projects.map((each) => (
            <MenuItem
              key={each.id}
              role="menuitemradio"
              aria-checked={todo.project?.id === each.id}
              selected={todo.project?.id === each.id}
              icon="dashboard"
              truncate
              onClick={() => {
                close();
                if (todo.project?.id !== each.id) onChange({ projectId: each.id });
              }}
            >
              {each.name}
            </MenuItem>
          ))}
          <MenuDivider />
          <label className="flex h-8 items-center gap-2 px-2 text-sm">
            <Icon name="add" size="sm" className="shrink-0 text-fg-subtle" />
            <input
              value={name}
              maxLength={MAX_PROJECT_NAME}
              placeholder="Neues Projekt …"
              aria-label="Neues Projekt"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                // Typed letters stay in the field; Esc closes the picker as anywhere in it.
                if (event.key !== 'Escape') event.stopPropagation();
                if (event.key !== 'Enter' || !name.trim()) return;
                const text = name.trim();
                setName('');
                close();
                create.mutateAsync({ name: text, areaId: todo.areaId }).then(
                  (made) => onChange({ projectId: made.id }),
                  (error: Error) => ui.notify(error.message, 'danger'),
                );
              }}
              className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
            />
          </label>
        </>
      )}
    </Picker>
  );
}

/** One's own to-dos stand under one's own picture, as „Meine Dateien“ are one's own. */
const MINE = 'Meine Aufgaben';
function MeAvatar() {
  const me = useMe().data?.viewer.author;
  return me ? (
    <Avatar author={me} size={18} nativeTitle={false} />
  ) : (
    <Icon name="person" size="sm" />
  );
}

/** Where it stands: one's own, or an area one may write in. */
function PlacePicker({ todo, onChange }: { todo: Todo; onChange: (change: TodoChange) => void }) {
  const ui = useCloud();
  const areas = (ui.home?.areas ?? []).filter(
    (area) => area.access === 'edit' || area.access === 'manage',
  );
  const here = ui.home?.areas.find((area) => area.id === todo.areaId);
  // Only the one who wrote one's own can move it; an area's, whoever may change it.
  return (
    <Picker
      wide
      label={`Ort: ${here ? here.name : MINE}`}
      disabled={!todo.canEdit}
      trigger={
        <>
          <span className="flex size-5 shrink-0 items-center justify-center">
            {here ? <AreaDot color={here.color} /> : <MeAvatar />}
          </span>
          <span className="truncate">{here ? here.name : MINE}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem
            role="menuitemradio"
            aria-checked={todo.areaId === null}
            selected={todo.areaId === null}
            icon={<MeAvatar />}
            onClick={() => {
              close();
              if (todo.areaId !== null) onChange({ areaId: null });
            }}
          >
            {MINE}
          </MenuItem>
          {areas.map((area) => (
            <MenuItem
              key={area.id}
              role="menuitemradio"
              aria-checked={todo.areaId === area.id}
              selected={todo.areaId === area.id}
              icon={<AreaDot color={area.color} />}
              truncate
              onClick={() => {
                close();
                if (todo.areaId !== area.id) onChange({ areaId: area.id });
              }}
            >
              {area.name}
            </MenuItem>
          ))}
        </>
      )}
    </Picker>
  );
}

/**
 * In the side panel: its title with how it stands (status, priority) and its words; who does it,
 * when and where as lines under them; the agent docked at its foot with „Losschicken“, who made
 * it last.
 */
function TodoDetail({
  todo,
  onChange,
  onClose,
}: {
  todo: Todo;
  onChange: (change: TodoChange, files?: Attachment[]) => void;
  onClose: () => void;
}) {
  const ui = useCloud();
  const { sendable: canSend } = useTodoAgent(todo);
  const send = useSendAgent(todo);
  const agents = useCloudAgents(ui.workspace.id).data ?? [];
  // A line for the agent where one may give it one, or one is given it.
  const agentShown =
    !!todo.assigneeAgent ||
    (todo.canEdit && (canCreateDecks(ui.workspace.role) || agentsFor(todo, agents).length > 0));
  const [title, setTitle] = useState(todo.title);
  const [words, setWords] = useState(todo.description);
  // Changed elsewhere (live, an agent): the fields follow.
  const [seen, setSeen] = useState(todo);
  if (seen !== todo) {
    setSeen(todo);
    if (seen.title !== todo.title) setTitle(todo.title);
    if (seen.description !== todo.description) setWords(todo.description);
  }
  const saveTitle = () => {
    const text = title.trim();
    if (!text) setTitle(todo.title);
    else if (text !== todo.title) onChange({ title: text });
  };
  const saveWords = () => {
    if (words !== todo.description) onChange({ description: words });
  };
  // Files pasted into its words or picked with the clip: up, they are on it at once.
  const [deletingFile, setDeletingFile] = useState<Attachment | null>(null);
  const attach = useAttachments({
    workspaceId: todo.canEdit ? ui.workspace.id : null,
    onError: (message) => ui.notify(message, 'danger'),
  });
  const setFiles = (files: Attachment[]) =>
    onChange({ attachments: files.map((one) => one.id) }, files);
  const upCount = attach.busy ? 0 : attach.ready.length;
  useEffect(() => {
    if (upCount === 0) return;
    const files = [...(todo.attachments ?? []), ...attach.ready];
    attach.clear();
    setFiles(files);
    // Only once all are up; `todo` is the one shown now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upCount]);
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline py-2.5 pr-2.5 pl-5">
        <span className="flex-1 text-sm text-fg-muted tabular-nums">#{todo.number}</span>
        <TodoActions todo={todo} button />
        <IconButton icon="close" label="Aufgabe schließen (Esc)" size="sm" onClick={onClose} />
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
        {/* A long title wraps, as Linear's; it stays one line of words – Enter puts it in. */}
        <AutosizeTextarea
          value={title}
          readOnly={!todo.canEdit}
          onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, ' '))}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
          maxLength={300}
          maxHeight={Infinity}
          aria-label="Titel"
          className="text-lg leading-snug font-semibold text-fg"
        />
        {/* How it stands, right with its title. */}
        <PickerLook value="chip">
          <div className="-mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPicker todo={todo} onChange={onChange} labelled />
            <PriorityPicker todo={todo} onChange={onChange} labelled />
          </div>
        </PickerLook>
        <AutosizeTextarea
          value={words}
          readOnly={!todo.canEdit}
          onChange={(event) => setWords(event.target.value)}
          onBlur={saveWords}
          onPaste={attach.onPaste}
          maxHeight={Infinity}
          placeholder={todo.canEdit ? 'Beschreibung hinzufügen …' : 'Keine Beschreibung'}
          aria-label="Beschreibung"
          className="resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
        />
        {(todo.attachments?.length || attach.items.length > 0 || attach.enabled) && (
          <div className="-mt-2 flex flex-col gap-1.5">
            <SentAttachments
              attachments={todo.attachments}
              onDelete={todo.canEdit ? setDeletingFile : undefined}
            />
            <AttachmentChips files={attach} />
            {attach.enabled && (
              <div className="-ml-1.5 flex">
                <AttachButton files={attach} />
              </div>
            )}
          </div>
        )}
        {deletingFile && (
          <ConfirmDialog
            title={`„${deletingFile.name}“ löschen?`}
            description="Die Datei geht von der Aufgabe und wird gelöscht."
            confirmLabel="Löschen"
            onClose={() => setDeletingFile(null)}
            onConfirm={() => {
              const gone = deletingFile;
              setDeletingFile(null);
              setFiles((todo.attachments ?? []).filter((one) => one.id !== gone.id));
              ui.notify(`„${gone.name}“ gelöscht`);
            }}
          />
        )}
        {/* Who else does it, when, where: lines across, each with its mark in front. */}
        <PickerLook value="row">
          <div className="border-t border-hairline pt-3">
            <div className="-mx-2 flex flex-col">
              <WhoPicker todo={todo} onChange={onChange} part="person" />
              <StartPicker todo={todo} onChange={onChange} />
              <DuePicker todo={todo} onChange={onChange} />
              <MilestonePicker todo={todo} onChange={onChange} />
              <BlockedByPicker todo={todo} onChange={onChange} />
              <PlacePicker todo={todo} onChange={onChange} />
              <ProjectPicker todo={todo} onChange={onChange} />
            </div>
          </div>
        </PickerLook>
        {/* At its foot, whatever the words' length: the agent that works on it, who made it. */}
        <div className="mt-auto flex flex-col gap-3 pt-6">
          {agentShown && (
            <section
              aria-label="Agent"
              className="flex flex-col gap-2 rounded-panel border border-hairline p-2"
            >
              <PickerLook value="card">
                <WhoPicker todo={todo} onChange={onChange} part="agent" />
              </PickerLook>
              {canSend && (
                <Button icon="send" onClick={send} className="w-full">
                  Losschicken
                </Button>
              )}
            </section>
          )}
          <p className="flex flex-wrap items-center gap-x-3 border-t border-hairline pt-3 text-xs text-fg-faint">
            <span>
              {todo.agent
                ? `Angelegt von ${todo.agent.title}`
                : todo.createdBy
                  ? `Angelegt von ${todo.createdBy.id === ui.userId ? 'dir' : todo.createdBy.name}`
                  : 'Angelegt'}{' '}
              am {new Date(todo.createdAt).toLocaleDateString('de-DE')}
            </span>
            {todo.source?.kind === 'mail' && (
              <Link
                to={`${routes.cloudMail(ui.workspace.id)}/${todo.source.threadId}`}
                className="flex items-center gap-1 hover:text-fg"
              >
                <Icon name="mail" size="xs" />
                Aus einer Mail
              </Link>
            )}
            {todo.source?.url && (
              <a
                href={todo.source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 hover:text-fg"
              >
                <Icon name="openInNew" size="xs" />
                {todo.source.label ?? 'Öffnen'}
              </a>
            )}
          </p>
        </div>
      </div>
    </>
  );
}
