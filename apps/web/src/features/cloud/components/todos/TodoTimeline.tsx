import {
  isOpenTodo,
  MAX_MILESTONE_NAME,
  type Todo,
  type TodoChange,
  type TodoMilestone,
} from '@slider/shared';
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  useCreateMilestone,
  useDeleteMilestone,
  useUpdateMilestone,
  useUpdateTodo,
} from '@/lib/api';
import { Avatar, Button, ConfirmDialog, Icon, IconButton, Menu, cn, useMediaQuery } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { at, iso, plus, todayNoon } from '../calendar/days';
import { TodoActions } from './TodoActions';
import { StatusMark } from './TodoMarks';
import { between, rangeOf, spanOf } from './timeline';

/** One day's width, one line's height (px). */
const DAY = 28;
const LINE = 36;

const dayLabel = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const monthLabel = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const weekdayLetter = new Intl.DateTimeFormat('de-DE', { weekday: 'narrow' });

/** A span kept: one day is a due day alone; longer, from start to due. */
const asChange = ([start, end]: [string, string]): TodoChange =>
  start === end ? { startOn: null, dueOn: end } : { startOn: start, dueOn: end };

type Grip = 'move' | 'start' | 'end' | 'new';
interface Drag {
  key: string;
  grip: Grip;
  x: number;
  /** As it stood when grabbed – every move counted from there. */
  origin: [string, string];
  /** As it stands while dragged. */
  span: [string, string];
  moved: boolean;
}

/**
 * The to-dos on a timeline („Zeitplan“) – Linear's, simpler: one line each, grouped under the
 * milestone they lead to (its date a diamond, a dashed line down the chart), those without one
 * last. A bar runs from start to due; dragged it moves, its ends change start or due; a line with
 * no dates is drawn on. The diamond is dragged to another day. A click opens the to-do.
 */
export function TodoTimeline({
  todos,
  milestones,
  openId,
  onToggle,
  newIn,
  lead,
}: {
  todos: readonly Todo[];
  milestones: readonly TodoMilestone[];
  openId: string | null;
  onToggle: (id: string) => void;
  /** Where a new milestone goes (the place shown); `undefined`: none can be made here. */
  newIn: { areaId: string | null } | undefined;
  /** Its place's mark beside a milestone – on the overview, where places mix. */
  lead?: (areaId: string | null) => ReactNode;
}) {
  const ui = useCloud();
  const update = useUpdateTodo(ui.workspace.id);
  const moveMilestone = useUpdateMilestone(ui.workspace.id);
  const narrow = useMediaQuery('(max-width: 639px)');
  const names = narrow ? 168 : 288;
  const today = todayNoon();
  const { from, count } = rangeOf(todos, milestones, today);
  const xOf = (day: string) => between(from, at(day)) * DAY;
  const dayAt = (x: number) => iso(plus(from, Math.floor(x / DAY)));
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  // A right click on a line: its menu at the pointer, as on a tile or row. The to-do stays when
  // the menu closes, so the question „löschen?“ it may ask has it still.
  const [menu, setMenu] = useState<{ todo: Todo; at: { x: number; y: number } | null } | null>(
    null,
  );

  // Opened at today, a few days before it on the left.
  const todayX = between(from, today) * DAY;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 3 * DAY);
    // Only when first shown – later the person scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTodo = (todo: Todo, change: TodoChange) =>
    update.mutate(
      { id: todo.id, change },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
  const dateMilestone = (milestone: TodoMilestone, dueOn: string | null) =>
    moveMilestone.mutate(
      { id: milestone.id, change: { dueOn } },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );

  /** Pointer down on a bar, its end, a diamond, or an empty line: dragged by whole days. */
  const grab = (key: string, grip: Grip, span: [string, string]) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ key, grip, x: event.clientX, origin: span, span, moved: false });
  };
  const follow = (event: PointerEvent) => {
    if (!drag) return;
    const by = Math.round((event.clientX - drag.x) / DAY);
    if (by === 0 && !drag.moved) return;
    setDrag({ ...drag, moved: true, span: shifted(drag, by) });
  };
  const shifted = (state: Drag, by: number): [string, string] => {
    const [start, end] = state.grip === 'new' ? [state.origin[0], state.origin[0]] : state.origin;
    const move = (day: string) => iso(plus(at(day), by));
    if (state.grip === 'move') return [move(start), move(end)];
    if (state.grip === 'start') return move(start) <= end ? [move(start), end] : [end, move(start)];
    const to = move(end);
    return to >= start ? [start, to] : [to, start];
  };
  /** Let go: kept when moved (or drawn on a line); not moved, a bar was clicked – `onClick`. */
  const drop = (
    event: PointerEvent,
    original: [string, string] | null,
    keep: (span: [string, string]) => void,
    onClick?: () => void,
  ) => {
    if (!drag) return;
    const by = Math.round((event.clientX - drag.x) / DAY);
    const span = drag.moved ? shifted(drag, by) : drag.span;
    const changed = !original || span[0] !== original[0] || span[1] !== original[1];
    if ((drag.moved || drag.grip === 'new') && changed) keep(span);
    else if (!drag.moved) onClick?.();
    setDrag(null);
  };
  /** The browser took the pointer (a touch turned into scrolling, a system gesture): nothing kept. */
  const cancel = () => setDrag(null);
  const preview = (key: string, span: [string, string] | null) =>
    drag?.key === key ? drag.span : span;

  /** ← → move it a day; with ⇧ only its due day. */
  const nudge = (todo: Todo, span: [string, string] | null) => (event: KeyboardEvent) => {
    if (!span || !todo.canEdit || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const by = event.key === 'ArrowLeft' ? -1 : 1;
    const move = (day: string) => iso(plus(at(day), by));
    const next: [string, string] = event.shiftKey
      ? [span[0], move(span[1]) < span[0] ? span[0] : move(span[1])]
      : [move(span[0]), move(span[1])];
    changeTodo(todo, asChange(next));
  };

  // Under each milestone (by date), those without one last; in each, by start, the unplanned last.
  const known = new Set(milestones.map((milestone) => milestone.id));
  const byStart = (list: Todo[]) =>
    list
      .map((todo, index) => ({ todo, index, span: spanOf(todo) }))
      .sort(
        (a, b) => (a.span?.[0] ?? '9999').localeCompare(b.span?.[0] ?? '9999') || a.index - b.index,
      )
      .map((each) => each.todo);
  const groups = [
    ...milestones.map((milestone) => ({
      key: milestone.id,
      milestone,
      todos: byStart(todos.filter((todo) => todo.milestone?.id === milestone.id)),
    })),
    {
      key: 'none',
      milestone: null,
      todos: byStart(todos.filter((todo) => !todo.milestone || !known.has(todo.milestone.id))),
    },
  ].filter((group) => group.milestone || group.todos.length > 0);

  const width = names + count * DAY;
  const days = Array.from({ length: count }, (_, index) => plus(from, index));
  const nameCell = 'sticky left-0 z-(--z-raised) flex shrink-0 items-center bg-canvas';

  return (
    <section
      aria-label="Zeitplan"
      className="overflow-hidden rounded-panel border border-hairline bg-canvas"
    >
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain">
        <div className="relative" style={{ width }}>
          {/* Behind every line: weekends, today, each milestone's day. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: names,
              width: count * DAY,
              backgroundImage: `linear-gradient(to right, transparent ${5 * DAY}px, var(--color-surface-1) ${5 * DAY}px)`,
              backgroundSize: `${7 * DAY}px 100%`,
            }}
          >
            {milestones.map(
              (milestone) =>
                milestone.dueOn && (
                  <span
                    key={milestone.id}
                    className="absolute inset-y-0 border-l border-dashed border-fg-faint"
                    style={{
                      left:
                        xOf(preview(milestone.id, [milestone.dueOn, milestone.dueOn])![0]) +
                        DAY / 2,
                    }}
                  />
                ),
            )}
            <span
              className="absolute top-0 bottom-0 w-px bg-danger"
              style={{ left: todayX + DAY / 2 }}
            />
          </div>

          {/* The days: months above, each day's letter and number under them. */}
          <div className="relative flex border-b border-hairline">
            <div
              className={cn(nameCell, 'z-(--z-panel) gap-2 border-r border-hairline px-3')}
              style={{ width: names, height: 52 }}
            >
              <span className="flex-1 truncate text-xs font-medium text-fg-muted">
                {todos.length} {todos.length === 1 ? 'Aufgabe' : 'Aufgaben'}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  scroller.current?.scrollTo({
                    left: Math.max(0, todayX - 3 * DAY),
                    behavior: 'smooth',
                  })
                }
              >
                Heute
              </Button>
            </div>
            <div className="relative" style={{ width: count * DAY, height: 52 }}>
              {days.map(
                (day, index) =>
                  (index === 0 || day.getDate() === 1) && (
                    <span
                      key={`m${index}`}
                      className="absolute top-1.5 truncate pl-1.5 text-xs font-medium text-fg"
                      style={{ left: index * DAY }}
                    >
                      {monthLabel.format(day)}
                    </span>
                  ),
              )}
              {days.map((day, index) => {
                const isToday = index === between(from, today);
                return (
                  <span
                    key={index}
                    className={cn(
                      'absolute bottom-1 flex flex-col items-center text-micro leading-tight tabular-nums',
                      isToday ? 'font-semibold text-danger' : 'text-fg-subtle',
                    )}
                    style={{ left: index * DAY, width: DAY }}
                  >
                    <span>{weekdayLetter.format(day)}</span>
                    <span>{day.getDate()}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {groups.map((group) => {
            const folded = shut.has(group.key);
            const done = group.todos.filter((todo) => !isOpenTodo(todo.status)).length;
            return (
              <div
                key={group.key}
                role="group"
                aria-label={group.milestone?.name ?? 'Ohne Meilenstein'}
              >
                <MilestoneLine
                  milestone={group.milestone}
                  names={names}
                  width={count * DAY}
                  folded={folded}
                  onFold={() =>
                    setShut((now) => {
                      const next = new Set(now);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  count={`${done}/${group.todos.length}`}
                  lead={lead && group.milestone ? lead(group.milestone.areaId) : undefined}
                  marker={(() => {
                    const milestone = group.milestone;
                    if (!milestone) return null;
                    const span = preview(
                      milestone.id,
                      milestone.dueOn ? [milestone.dueOn, milestone.dueOn] : null,
                    );
                    const keep = (next: [string, string]) => dateMilestone(milestone, next[1]);
                    const dueOn = milestone.dueOn;
                    // No date yet: a click on its line gives it one (the line stays under the
                    // pointer while it is dragged, its diamond only shown).
                    if (!dueOn)
                      return (
                        milestone.canEdit && (
                          <div
                            className="absolute inset-0 cursor-crosshair"
                            title="Klicken, um ein Datum zu setzen"
                            onPointerDown={(event) => {
                              const box = event.currentTarget.getBoundingClientRect();
                              const day = dayAt(event.clientX - box.left);
                              grab(milestone.id, 'new', [day, day])(event);
                            }}
                            onPointerMove={follow}
                            onPointerUp={(event) => drop(event, null, keep)}
                            onPointerCancel={cancel}
                          >
                            {span && (
                              <span
                                className="absolute top-1/2 size-3.5 -translate-y-1/2 rotate-45 rounded-[3px] bg-fg"
                                style={{ left: xOf(span[1]) + DAY / 2 - 7 }}
                              />
                            )}
                          </div>
                        )
                      );
                    if (!span) return null;
                    return (
                      <button
                        type="button"
                        aria-label={`${milestone.name}: ${dayLabel.format(at(span[1]))}`}
                        title={`${milestone.name} | ${dayLabel.format(at(span[1]))}${milestone.canEdit ? ' – ziehen, um es zu verschieben' : ''}`}
                        disabled={!milestone.canEdit}
                        className={cn(
                          'absolute top-1/2 flex -translate-y-1/2 items-center gap-2 disabled:cursor-default',
                          milestone.canEdit && 'cursor-ew-resize touch-none',
                        )}
                        style={{ left: xOf(span[1]) + DAY / 2 - 7 }}
                        onPointerDown={
                          milestone.canEdit ? grab(milestone.id, 'move', span) : undefined
                        }
                        onPointerMove={follow}
                        onPointerUp={(event) => drop(event, [dueOn, dueOn], keep)}
                        onPointerCancel={cancel}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                          event.preventDefault();
                          const day = iso(plus(at(span[1]), event.key === 'ArrowLeft' ? -1 : 1));
                          dateMilestone(milestone, day);
                        }}
                      >
                        <span
                          className={cn(
                            'size-3.5 rotate-45 rounded-[3px]',
                            group.todos.length > 0 && done === group.todos.length
                              ? 'bg-success'
                              : 'bg-fg',
                          )}
                        />
                        <span className="text-xs whitespace-nowrap text-fg-muted tabular-nums">
                          {dayLabel.format(at(span[1]))}
                        </span>
                      </button>
                    );
                  })()}
                />
                {!folded &&
                  group.todos.map((todo) => {
                    const own = spanOf(todo);
                    const span = preview(todo.id, own);
                    const open = openId === todo.id;
                    const overdue =
                      isOpenTodo(todo.status) && !!todo.dueOn && todo.dueOn < iso(today);
                    const keep = (next: [string, string]) => changeTodo(todo, asChange(next));
                    return (
                      <div
                        key={todo.id}
                        className="group/line flex"
                        style={{ height: LINE }}
                        onContextMenu={
                          todo.canEdit
                            ? (event) => {
                                if (event.shiftKey) return;
                                event.preventDefault();
                                setMenu({ todo, at: { x: event.clientX, y: event.clientY } });
                              }
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          aria-pressed={open}
                          onClick={() => onToggle(todo.id)}
                          className={cn(
                            nameCell,
                            'gap-2 border-r border-hairline pr-3 pl-8 text-left text-sm',
                            open ? 'bg-selected' : 'hover:bg-hover',
                          )}
                          style={{ width: names }}
                        >
                          <StatusMark status={todo.status} />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              isOpenTodo(todo.status) ? 'text-fg' : 'text-fg-muted line-through',
                            )}
                          >
                            {todo.title}
                          </span>
                          <span className="text-xs text-fg-faint tabular-nums">#{todo.number}</span>
                        </button>
                        <div
                          className={cn(
                            'relative',
                            !span && todo.canEdit && 'cursor-crosshair',
                            open && 'bg-selected/40',
                          )}
                          style={{ width: count * DAY }}
                          // Not planned yet: drawn on its line.
                          onPointerDown={
                            !span && todo.canEdit
                              ? (event) => {
                                  const box = event.currentTarget.getBoundingClientRect();
                                  const day = dayAt(event.clientX - box.left);
                                  grab(todo.id, 'new', [day, day])(event);
                                }
                              : undefined
                          }
                          onPointerMove={follow}
                          onPointerUp={!own ? (event) => drop(event, null, keep) : undefined}
                          onPointerCancel={cancel}
                        >
                          {!span && todo.canEdit && (
                            <span
                              className="pointer-events-none absolute inset-y-0 hidden items-center text-xs text-fg-faint group-hover/line:flex"
                              style={{ left: Math.max(12, todayX - 3 * DAY + 12) }}
                            >
                              Ziehen, um sie zu planen
                            </span>
                          )}
                          {span && (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={`${todo.title}: ${dayLabel.format(at(span[0]))} bis ${dayLabel.format(at(span[1]))}`}
                              title={`${todo.title} | ${span[0] === span[1] ? dayLabel.format(at(span[1])) : `${dayLabel.format(at(span[0]))} – ${dayLabel.format(at(span[1]))}`}`}
                              className={cn(
                                'absolute top-1.5 bottom-1.5 flex items-center gap-1.5 overflow-hidden rounded-control px-2 text-xs select-none',
                                todo.status === 'done'
                                  ? 'bg-success/20 text-fg-muted'
                                  : todo.status === 'canceled'
                                    ? 'bg-surface-2 text-fg-faint line-through'
                                    : todo.status === 'in_progress'
                                      ? 'bg-warning/25 text-fg'
                                      : 'bg-surface-3 text-fg',
                                overdue && 'inset-ring inset-ring-danger/60',
                                open && 'ring-2 ring-fg',
                                todo.canEdit
                                  ? 'cursor-grab touch-none active:cursor-grabbing'
                                  : 'cursor-pointer',
                                drag?.key === todo.id && 'shadow-lg',
                              )}
                              style={{
                                left: xOf(span[0]) + 2,
                                width: (between(at(span[0]), at(span[1])) + 1) * DAY - 4,
                              }}
                              onPointerDown={todo.canEdit ? grab(todo.id, 'move', span) : undefined}
                              onPointerUp={(event) =>
                                drop(event, own, keep, () => onToggle(todo.id))
                              }
                              // Not to be moved: a plain click (to be moved, `drop` tells it).
                              onClick={todo.canEdit ? undefined : () => onToggle(todo.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  onToggle(todo.id);
                                } else nudge(todo, own)(event);
                              }}
                            >
                              {todo.assignee && (
                                <Avatar author={todo.assignee} size={16} nativeTitle={false} />
                              )}
                              <span className="truncate">{todo.title}</span>
                              {todo.canEdit && (
                                <>
                                  <span
                                    aria-hidden
                                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
                                    onPointerDown={grab(todo.id, 'start', span)}
                                  />
                                  <span
                                    aria-hidden
                                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                                    onPointerDown={grab(todo.id, 'end', span)}
                                  />
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {newIn && <NewMilestone names={names} areaId={newIn.areaId} />}
        </div>
      </div>
      {menu && (
        <TodoActions
          key={menu.todo.id}
          todo={todos.find((each) => each.id === menu.todo.id) ?? menu.todo}
          contextAt={menu.at}
          onContextClose={() => setMenu({ todo: menu.todo, at: null })}
        />
      )}
    </section>
  );
}

/** A milestone's line: fold, its flag and name (renamed where it stands), done of all, its menu. */
function MilestoneLine({
  milestone,
  names,
  width,
  folded,
  onFold,
  count,
  lead,
  marker,
}: {
  milestone: TodoMilestone | null;
  names: number;
  width: number;
  folded: boolean;
  onFold: () => void;
  count: string;
  lead?: ReactNode;
  marker: ReactNode;
}) {
  const ui = useCloud();
  const rename = useUpdateMilestone(ui.workspace.id);
  const remove = useDeleteMilestone(ui.workspace.id);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(milestone?.name ?? '');
  const [deleting, setDeleting] = useState(false);
  // Its name as it is now (renamed elsewhere meanwhile), not as it was when the line came.
  const startNaming = () => {
    setName(milestone?.name ?? '');
    setNaming(true);
  };
  const save = () => {
    setNaming(false);
    const text = name.trim();
    if (!milestone || !text || text === milestone.name) return setName(milestone?.name ?? '');
    rename.mutate(
      { id: milestone.id, change: { name: text } },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
  };
  return (
    <div className="group/milestone flex border-t border-hairline" style={{ height: LINE }}>
      <div
        className="sticky left-0 z-(--z-raised) flex shrink-0 items-center gap-1.5 border-r border-hairline bg-canvas pr-1.5 pl-2"
        style={{ width: names }}
      >
        <IconButton
          icon="chevronRight"
          label={folded ? 'Aufklappen' : 'Zuklappen'}
          size="xs"
          iconSize={14}
          onClick={onFold}
          className={cn('transition-transform', !folded && 'rotate-90')}
        />
        {lead}
        <Icon
          name="flag"
          size="sm"
          className={cn(
            'shrink-0',
            milestone ? 'text-fg-muted' : 'text-fg-faint',
            lead && 'max-sm:hidden',
          )}
        />
        {naming && milestone ? (
          <input
            autoFocus
            value={name}
            maxLength={MAX_MILESTONE_NAME}
            aria-label="Name des Meilensteins"
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setName(milestone.name);
                setNaming(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={milestone?.canEdit ? startNaming : undefined}
            onClick={onFold}
            title={milestone?.canEdit ? 'Doppelklick: umbenennen' : undefined}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg"
          >
            {milestone?.name ?? 'Ohne Meilenstein'}
          </button>
        )}
        <span className="text-xs text-fg-faint tabular-nums">{count}</span>
        {milestone?.canEdit && (
          <Menu
            label="Mehr zum Meilenstein"
            triggerSize="xs"
            triggerClassName="opacity-0 group-hover/milestone:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            actions={[
              { label: 'Umbenennen', icon: 'driveFileRename', onSelect: startNaming },
              ...(milestone.dueOn
                ? [
                    {
                      label: 'Datum entfernen',
                      icon: 'event' as const,
                      onSelect: () =>
                        rename.mutate(
                          { id: milestone.id, change: { dueOn: null } },
                          { onError: (error) => ui.notify(error.message, 'danger') },
                        ),
                    },
                  ]
                : []),
              {
                label: 'Löschen',
                icon: 'delete',
                tone: 'danger' as const,
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        )}
      </div>
      <div className="relative" style={{ width }}>
        {marker}
      </div>
      {deleting && milestone && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title={`„${milestone.name}“ löschen?`}
          description="Seine Aufgaben bleiben, nur ohne Meilenstein."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            setDeleting(false);
            remove.mutateAsync(milestone.id).then(
              () => ui.notify(`„${milestone.name}“ gelöscht`),
              (error: Error) => ui.notify(error.message, 'danger'),
            );
          }}
        />
      )}
    </div>
  );
}

/** Typed where it stands, under the last line: Enter makes it – the place's, without a date yet. */
function NewMilestone({ names, areaId }: { names: number; areaId: string | null }) {
  const ui = useCloud();
  const create = useCreateMilestone(ui.workspace.id);
  const [name, setName] = useState('');
  return (
    <div className="flex border-t border-hairline" style={{ height: LINE }}>
      <label
        className="sticky left-0 z-(--z-raised) flex shrink-0 items-center gap-2 border-r border-hairline bg-canvas px-3 text-sm"
        style={{ width: names }}
      >
        <Icon name="add" size="sm" className="shrink-0 text-fg-subtle" />
        <input
          value={name}
          maxLength={MAX_MILESTONE_NAME}
          placeholder="Neuer Meilenstein …"
          aria-label="Neuer Meilenstein"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setName('');
            if (event.key !== 'Enter' || !name.trim()) return;
            const text = name.trim();
            setName('');
            create.mutate(
              { name: text, areaId },
              { onError: (error) => ui.notify(error.message, 'danger') },
            );
          }}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
        />
      </label>
    </div>
  );
}
