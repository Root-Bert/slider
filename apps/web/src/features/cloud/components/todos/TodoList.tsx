import {
  isOpenTodo,
  TODO_PRIORITIES,
  TODO_PRIORITY_LABELS,
  TODO_STATUS_LABELS,
  TODO_STATUSES,
  type CloudAgentSummary,
  type CloudArea,
  type CloudPerson,
  type Todo,
  type TodoChange,
} from '@slider/shared';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  useCloudAgents,
  useCloudPeople,
  useCreateTodo,
  useDeleteTodo,
  useMe,
  useTodos,
  useUpdateTodo,
} from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import { CLOUD_EVENT_PARAM, CLOUD_FILE_PARAM, CLOUD_TODO_PARAM, routes } from '@/lib/routes';
import { WorkspaceMark } from '@/features/workspaces';
import {
  AutosizeTextarea,
  Avatar,
  ConfirmDialog,
  GlassPanel,
  Icon,
  IconButton,
  LoadingState,
  Menu,
  MenuDivider,
  MenuHeading,
  MenuItem,
  PopoverPanel,
  SegmentedControl,
  SidePanel,
  TextField,
  TextLink,
  cn,
  usePopover,
} from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { useStoredChoice } from '../../hooks/useStoredChoice';
import { AgentAvatar } from '../AgentAvatar';
import { AgentViewToggle, GRID } from '../AgentList';
import { AreaDot } from '../AreaDot';
import { DueCalendar } from './DueCalendar';
import { PriorityMark, StatusMark } from './TodoMarks';
import { byUrgency, isMine } from './order';

/**
 * To-dos as Linear's issues at their simplest. `area` given: that area's, by status – a project's
 * plan; none: the overview of one's own and every area's one sees, by where they stand.
 */
export function TodoList({ area }: { area: CloudArea | null }) {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const todos = useTodos(workspaceId, area?.id ?? null);
  const shown = useShownTodo();
  const me = useMe().data?.viewer.author;
  const [view, setView] = useStoredChoice('slider.cloud.todos-view', TODO_VIEWS, 'list');
  // None picked: all of them. A click on the one picked lets go of it – as on „Agenten“.
  const [picked, setScope] = useStoredChoice(
    'slider.cloud.todos-scope',
    ['all', ...SCOPES] as const,
    'all',
  );
  if (!todos.data) return <LoadingState padding="lg" />;
  const all = todos.data;
  const groups: Record<Scope, Todo[]> = {
    own: all.filter((todo) => todo.areaId === null),
    workspace: all.filter((todo) => todo.areaId !== null),
  };
  // In an area all are the area's: nothing to pick between.
  const scope = !area && picked !== 'all' ? picked : null;
  const list = scope ? groups[scope] : all;
  const canAdd = !area || area.access === 'edit' || area.access === 'manage';
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
      {/* The new one's field, whose and tiles or rows: one line, as on „Agenten“. */}
      {(canAdd || all.length > 0) && (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">{canAdd && <NewTodo areaId={area?.id ?? null} />}</div>
          {!area && all.length > 0 && (
            <GlassPanel className="shrink-0 p-1">
              <SegmentedControl
                label="Wessen Aufgaben"
                value={scope ?? 'all'}
                onChange={(next) => setScope(next === scope ? 'all' : next)}
                segments={SCOPES.map((each) => ({
                  value: each,
                  label: SCOPE_WORDS[each].label,
                  ...(each === 'workspace'
                    ? {
                        lead: (
                          <WorkspaceMark
                            name={ui.workspace.name}
                            logoUrl={ui.workspace.logoUrl}
                            size={24}
                            className="size-4.5!"
                          />
                        ),
                      }
                    : {
                        ...(me
                          ? { lead: <Avatar author={me} size={20} nativeTitle={false} /> }
                          : { icon: 'person' as const }),
                        iconOnly: true,
                      }),
                  count: groups[each].filter((todo) => isOpenTodo(todo.status)).length,
                  title: `${SCOPE_WORDS[each].label} | ${SCOPE_WORDS[each].hint}`,
                }))}
              />
            </GlassPanel>
          )}
          {all.length > 0 && <AgentViewToggle view={view} onChange={setView} />}
        </div>
      )}
      {scope && list.length === 0 ? (
        <p className="px-3 text-sm text-fg-muted">{SCOPE_WORDS[scope].none}</p>
      ) : list.length === 0 ? (
        <p className="px-3 text-sm text-fg-muted">
          {area
            ? 'Noch keine Aufgaben in diesem Bereich.'
            : 'Noch keine Aufgaben – deine und die aus deinen Bereichen stehen hier.'}
        </p>
      ) : area ? (
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
        <Overview list={list} rows={rows} tiles={tiles} />
      )}
    </div>
  );
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

/** Rows (Linear's) or tiles (as agents'): remembered in this browser. */
const TODO_VIEWS = ['list', 'tiles'] as const;
/** Whose to-dos the overview shows: one's own or the areas' – as „Agenten“ picks. */
const SCOPES = ['own', 'workspace'] as const;
type Scope = (typeof SCOPES)[number];
const SCOPE_WORDS: Record<Scope, { label: string; hint: string; none: string }> = {
  own: { label: 'Meine', hint: 'Nur du siehst sie', none: 'Du hast noch keine eigene Aufgabe.' },
  workspace: {
    label: 'Workspace',
    hint: 'Aus den Bereichen, die du siehst',
    none: 'In deinen Bereichen steht noch keine Aufgabe.',
  },
};

/** Linear's order of the groups: what is under way first, the finished last. */
const BY_STATUS = ['in_progress', 'todo', 'backlog', 'done', 'canceled'] as const;

/** One's own first, then each area – the open ones, the finished folded under them. */
function Overview({
  list,
  rows,
  tiles,
}: {
  list: readonly Todo[];
  rows: (each: readonly Todo[]) => ReactNode;
  tiles: boolean;
}) {
  const ui = useCloud();
  const areas = ui.home?.areas ?? [];
  const places: { key: string; title: string; lead: ReactNode; todos: Todo[] }[] = [];
  const own = list.filter((todo) => todo.areaId === null);
  if (own.length) {
    places.push({
      key: 'own',
      title: MINE,
      lead: <MeAvatar />,
      todos: own,
    });
  }
  for (const area of areas) {
    const here = list.filter((todo) => todo.areaId === area.id);
    if (here.length) {
      places.push({
        key: area.id,
        title: area.name,
        lead: <AreaDot color={area.color} />,
        todos: here,
      });
    }
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

/** Typed where it stands: Enter puts it in – one's own in the overview, the area's in an area. */
function NewTodo({ areaId }: { areaId: string | null }) {
  const ui = useCloud();
  const create = useCreateTodo(ui.workspace.id);
  const [title, setTitle] = useState('');
  const add = () => {
    const text = title.trim();
    if (!text) return;
    setTitle('');
    create.mutate(
      { title: text, areaId },
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
      placeholder={areaId ? 'Neue Aufgabe im Bereich' : 'Neue Aufgabe'}
      aria-label="Neue Aufgabe"
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
  return (
    <li>
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
            <span className="truncate">{area.name}</span>
          </span>
        )}
        {todo.description && <Icon name="notes" size="sm" className="text-fg-faint" />}
        {todo.source && <Icon name="mail" size="sm" className="text-fg-faint" />}
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
  return (
    <li
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
    </li>
  );
}

/** A change, at once (`useUpdateTodo`); refused, a toast says why and the list is back. */
function useChange(todo: Todo | null) {
  const ui = useCloud();
  const update = useUpdateTodo(ui.workspace.id);
  return (change: TodoChange) =>
    todo &&
    update.mutate(
      { id: todo.id, change },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
}

/** A property's choice in a small panel beside it, closed on pick – Linear's pickers. */
export function Picker({
  label,
  trigger,
  disabled,
  wide = false,
  calendar = false,
  className,
  children,
}: {
  label: string;
  trigger: ReactNode;
  disabled: boolean;
  wide?: boolean;
  /** A month to pick a day from: a dialog, wide enough for a week. */
  calendar?: boolean;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { open, close, wrapperRef, panelId, triggerProps } = usePopover({
    hasPopup: calendar ? 'dialog' : 'menu',
  });
  return (
    <div ref={wrapperRef} className="relative flex shrink-0">
      <button
        type="button"
        {...triggerProps}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-control-sm px-1 text-sm',
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

/** The one doing it – a person, an agent sent on it, or both; the agent's face pulses while it works. */
function WhoPicker({
  todo,
  onChange,
  labelled = false,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
  labelled?: boolean;
}) {
  const ui = useCloud();
  const people = useCloudPeople(ui.workspace.id).data ?? [];
  const agents = useCloudAgents(ui.workspace.id).data ?? [];
  const area = ui.home?.areas.find((each) => each.id === todo.areaId);
  const working = todo.assigneeAgent
    ? (agents.find((agent) => agent.id === todo.assigneeAgent?.id)?.running ?? false)
    : false;
  const label = [
    todo.assignee ? todo.assignee.name : null,
    todo.assigneeAgent ? `${todo.assigneeAgent.title}${working ? ' arbeitet daran' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const candidates = peopleFor(todo, people, area, ui.userId);
  const sendable = agentsFor(todo, agents);
  return (
    <Picker
      wide
      label={label ? `Zuständig: ${label}` : 'Zuständig: niemand'}
      disabled={!todo.canEdit}
      trigger={
        <>
          <span className="flex items-center -space-x-1">
            {todo.assigneeAgent && (
              <span className="relative flex rounded-control">
                <AgentAvatar id={todo.assigneeAgent.id} size={20} />
                {working && (
                  <span className="absolute -right-0.5 -bottom-0.5 size-2 animate-pulse rounded-full bg-success ring-2 ring-canvas" />
                )}
              </span>
            )}
            {todo.assignee && <Avatar author={todo.assignee} size={20} nativeTitle={false} />}
            {!todo.assignee && !todo.assigneeAgent && (
              <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-fg-faint text-fg-faint">
                <Icon name="person" size={12} />
              </span>
            )}
          </span>
          {labelled && <span className="truncate">{label || 'Niemand'}</span>}
        </>
      }
    >
      {(close) => (
        <>
          <MenuHeading>Person</MenuHeading>
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
          {sendable.length > 0 && (
            <>
              <MenuDivider />
              <MenuHeading>Agent losschicken</MenuHeading>
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
          <Icon name="schedule" size="sm" />
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
          {here ? <AreaDot color={here.color} /> : <MeAvatar />}
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

/** In the side panel: its words typed in place, its properties under them, who made it. */
function TodoDetail({
  todo,
  onChange,
  onClose,
}: {
  todo: Todo;
  onChange: (change: TodoChange) => void;
  onClose: () => void;
}) {
  const ui = useCloud();
  const remove = useDeleteTodo(ui.workspace.id);
  const [title, setTitle] = useState(todo.title);
  const [words, setWords] = useState(todo.description);
  const [deleting, setDeleting] = useState(false);
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
  const area = ui.home?.areas.find((each) => each.id === todo.areaId);
  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline py-2.5 pr-2.5 pl-5">
        <StatusMark status={todo.status} />
        <span className="text-sm text-fg-muted tabular-nums">#{todo.number}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-fg-muted">
          {area ? (
            <>
              <AreaDot color={area.color} />
              <span className="truncate">{area.name}</span>
            </>
          ) : (
            <>
              <MeAvatar />
              {MINE}
            </>
          )}
        </span>
        {todo.canEdit && (
          <Menu
            label="Mehr zur Aufgabe"
            actions={[
              {
                label: 'Löschen',
                icon: 'delete',
                tone: 'danger',
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        )}
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
        <AutosizeTextarea
          value={words}
          readOnly={!todo.canEdit}
          onChange={(event) => setWords(event.target.value)}
          onBlur={saveWords}
          maxHeight={480}
          placeholder={todo.canEdit ? 'Beschreibung hinzufügen …' : 'Keine Beschreibung'}
          aria-label="Beschreibung"
          className="resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
        />
        <div className="flex flex-wrap items-center gap-1">
          <StatusPicker todo={todo} onChange={onChange} labelled />
          <PriorityPicker todo={todo} onChange={onChange} labelled />
          <WhoPicker todo={todo} onChange={onChange} labelled />
          <DuePicker todo={todo} onChange={onChange} />
          <PlacePicker todo={todo} onChange={onChange} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-fg-faint">
          <span>
            {todo.agent
              ? `Angelegt von ${todo.agent.title}`
              : todo.createdBy
                ? `Angelegt von ${todo.createdBy.id === ui.userId ? 'dir' : todo.createdBy.name}`
                : 'Angelegt'}
            {' · '}
            {new Date(todo.createdAt).toLocaleDateString('de-DE')}
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
        {deleting && (
          <ConfirmDialog
            onClose={() => setDeleting(false)}
            title={`„${todo.title}“ löschen?`}
            description="Die Aufgabe ist dann für alle weg."
            confirmLabel="Löschen"
            confirmIcon="delete"
            onConfirm={() => {
              setDeleting(false);
              remove.mutateAsync(todo.id).then(
                () => ui.notify(`„${todo.title}“ gelöscht`),
                (error: Error) => ui.notify(error.message, 'danger'),
              );
            }}
          />
        )}
      </div>
    </>
  );
}
