import {
  isOpenTodo,
  MAX_MILESTONE_NAME,
  type Todo,
  type TodoChange,
  type TodoMilestone,
} from '@slider/shared';
import {
  useEffect,
  useId,
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
import { ROW_MENU_CLASS } from '@/features/sender';
import { Avatar, Button, ConfirmDialog, Icon, IconButton, Menu, cn, useMediaQuery } from '@/ui';
import { roundedPath } from '@/lib/rounded-path';
import { useCloud } from '../../hooks/useCloud';
import { at, iso, plus, todayNoon } from '../calendar/days';
import { TodoActions } from './TodoActions';
import { StatusMark } from './TodoMarks';
import {
  between,
  chevronsAlong,
  heldUpBy,
  linkRoute,
  rangeOf,
  spanOf,
  startingTooEarly,
  type BarBox,
} from './timeline';

/** One day's width, one line's height (px). */
const DAY = 28;
const LINE = 36;
/** The days' head over the lines (px, with its border). */
const HEAD = 53;
/** A bar's gap to its line's edge, above and below (px; `top-1.5 bottom-1.5`). */
const BAR_INSET = 6;
/**
 * A line from what one waits on to it: a band, chevrons cut out of it the way it runs – its width,
 * its corners' radius, a chevron's depth and stroke, the room between two (px). Its ends meet the
 * bars' edges (the bars let what is under them show).
 */
const LINK = { width: 6, radius: 8, depth: 4.5, stroke: 2, spacing: 2 * DAY } as const;
/** Its tone: quiet; of the one open or dragged; starting too early. */
const LINK_TONES = {
  plain: 'var(--color-fg)',
  marked: 'var(--color-accent-blue)',
  late: 'var(--color-danger)',
} as const;
type LinkTone = keyof typeof LINK_TONES;
/** Press length (ms) that lifts a line by touch – as a row's menu opens on a long press. */
const HOLD_MS = 500;
/** Finger travel (px) that turns the press into scrolling (before), or into a move (after). */
const HOLD_SLOP = 10;

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
  y: number;
  /** As it stood when grabbed – every move counted from there. */
  origin: [string, string];
  /** As it stands while dragged. */
  span: [string, string];
  moved: boolean;
}

/** A line dragged up or down – to another place in its group or another's: from where, where to. */
interface Lift {
  id: string;
  y: number;
  dy: number;
  /** The group it would go to (`none`: without one); `null`: over none that takes it. */
  over: string | null;
  /** The line it would go before there; `null`: last. */
  before: string | null;
  /** The timeline's left edge on the screen – where its name follows the pointer. */
  left: number;
}

/**
 * The to-dos on a timeline („Zeitplan“) – Linear's, simpler: one line each, grouped under the
 * milestone they lead to (its date a diamond, a dashed line down the chart), those without one
 * last. A bar runs from start to due; dragged it moves, its ends change start or due; a line with
 * no dates is drawn on. The diamond is dragged to another day. A click opens the to-do. A line
 * runs from what one waits on to it (`linkRoute`): a band with round corners as the comments' lines
 * (`roundedPath`), chevrons cut out of it the way it runs (`chevronsAlong`).
 */
export function TodoTimeline({
  todos,
  milestones,
  openId,
  onToggle,
  newIn,
  picked = null,
  onPick,
  lead,
}: {
  todos: readonly Todo[];
  milestones: readonly TodoMilestone[];
  openId: string | null;
  onToggle: (id: string) => void;
  /** Where a new milestone goes (the place shown); `undefined`: none can be made here. */
  newIn: { areaId: string | null; projectId: string | null } | undefined;
  /** Where a new to-do goes (a milestone of the place made in; `null`: without one) – picked here. */
  picked?: string | null;
  onPick?: (milestoneId: string | null) => void;
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
  const linkId = `todo-link-${useId().replace(/[^\w-]/g, '')}`;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [lift, setLift] = useState<Lift | null>(null);
  // A name pressed (not yet moved); a line let go after a lift is no click.
  const pressed = useRef<{ id: string; x: number; y: number } | null>(null);
  const lifted = useRef(false);
  // A touch on a name: the timer that lifts its line, and whether that line is carried by touch.
  const hold = useRef<number | null>(null);
  const byTouch = useRef(false);
  const groupBoxes = useRef(new Map<string, HTMLDivElement>());
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
    setDrag({ key, grip, x: event.clientX, y: event.clientY, origin: span, span, moved: false });
  };
  const follow = (event: PointerEvent) => {
    if (lift) return moveLift(event);
    if (!drag) return;
    // A bar first pulled up or down goes to another milestone, not to other days (not by touch:
    // there that is scrolling).
    const dy = event.clientY - drag.y;
    const lifting = drag.grip === 'move' && !drag.moved && event.pointerType !== 'touch';
    const todo = lifting ? byId.get(drag.key) : undefined;
    if (todo && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(event.clientX - drag.x)) {
      setDrag(null);
      return startLift(todo, drag.y, event.clientY);
    }
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
    if (lift) return endLift();
    if (!drag) return;
    const by = Math.round((event.clientX - drag.x) / DAY);
    const span = drag.moved ? shifted(drag, by) : drag.span;
    const changed = !original || span[0] !== original[0] || span[1] !== original[1];
    if ((drag.moved || drag.grip === 'new') && changed) keep(span);
    else if (!drag.moved) onClick?.();
    setDrag(null);
  };
  /** The browser took the pointer (a touch turned into scrolling, a system gesture): nothing kept. */
  const cancel = () => {
    setDrag(null);
    setLift(null);
    pressed.current = null;
    letGo();
  };
  /** A touch ended: no lift waiting, the page scrolls again. */
  const letGo = () => {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
    byTouch.current = false;
  };
  useEffect(() => letGo, []);
  // Kept from scrolling while a line is carried by touch – listening from the start, not once
  // lifted, as Safari heeds only a listener there before the finger came down.
  useEffect(() => {
    const box = scroller.current;
    const still = (event: TouchEvent) => {
      if (byTouch.current) event.preventDefault();
    };
    box?.addEventListener('touchmove', still, { passive: false });
    return () => box?.removeEventListener('touchmove', still);
  }, []);
  const preview = (key: string, span: [string, string] | null) =>
    drag?.key === key ? drag.span : span;

  // What waits on what: the one dragged (or open) marks those it holds up and those it waits on;
  // one starting on or before an open one it waits on is due stands red – while dragged, where it
  // would go.
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const late = startingTooEarly(todos, (id) => {
    const todo = byId.get(id);
    return todo ? preview(id, spanOf(todo)) : null;
  });
  const focus = byId.get(drag?.key ?? openId ?? '');
  const held = focus ? heldUpBy(todos, focus.id) : new Set<string>();
  const linked = focus
    ? new Set([...held, ...focus.blockedBy.filter((id) => byId.has(id))])
    : new Set<string>();

  // Lines dragged up or down: to another place among its milestone's, or into another milestone of
  // its own place (or none).
  const known = new Set(milestones.map((milestone) => milestone.id));
  const groupOf = (todo: Todo) =>
    todo.milestone && known.has(todo.milestone.id) ? todo.milestone.id : 'none';
  /** A group's lines as they stand: by the place each was put (the same: by number). */
  const linesOf = (key: string) =>
    todos
      .filter((todo) => groupOf(todo) === key)
      .sort((a, b) => a.position - b.position || a.number - b.number);
  const takes = (key: string, todo: Todo) => {
    const milestone = milestones.find((each) => each.id === key);
    return (
      key === 'none' ||
      (!!milestone &&
        milestone.areaId === todo.areaId &&
        milestone.projectId === (todo.project?.id ?? null))
    );
  };
  /** Under the pointer: the group that takes it, and before which of its lines (by their halves). */
  const placeAt = (y: number, todo: Todo): Pick<Lift, 'over' | 'before'> => {
    for (const [key, box] of groupBoxes.current) {
      const rect = box.getBoundingClientRect();
      if (y < rect.top || y >= rect.bottom) continue;
      if (!takes(key, todo)) break;
      const lines = [...box.querySelectorAll<HTMLElement>('[data-line]')].filter(
        (line) => line.dataset.line !== todo.id,
      );
      const below = lines.find((line) => {
        const at = line.getBoundingClientRect();
        return y < at.top + at.height / 2;
      });
      return { over: key, before: below?.dataset.line ?? null };
    }
    return { over: null, before: null };
  };
  /** Where it would go changes nothing: its own group, right where it stands. */
  const staysAt = (todo: Todo, place: Pick<Lift, 'over' | 'before'>) => {
    if (place.over !== groupOf(todo)) return false;
    const lines = linesOf(place.over);
    return (lines[lines.findIndex((line) => line.id === todo.id) + 1]?.id ?? null) === place.before;
  };
  const startLift = (todo: Todo, from: number, y: number) => {
    const left = scroller.current?.getBoundingClientRect().left ?? 0;
    setLift({ id: todo.id, y: from, dy: y - from, left, ...placeAt(y, todo) });
  };
  const moveLift = (event: PointerEvent) => {
    const todo = lift && byId.get(lift.id);
    if (!lift || !todo) return;
    setLift({ ...lift, dy: event.clientY - lift.y, ...placeAt(event.clientY, todo) });
  };
  /** Let go: between its new neighbours (halfway), into that group's milestone if another. */
  const endLift = () => {
    const todo = lift && byId.get(lift.id);
    setLift(null);
    if (!todo || !lift.over || staysAt(todo, lift)) return;
    const lines = linesOf(lift.over).filter((line) => line.id !== todo.id);
    const at =
      lift.before === null ? lines.length : lines.findIndex((line) => line.id === lift.before);
    const [prev, next] = [lines[at - 1], lines[at]];
    const position =
      prev && next
        ? (prev.position + next.position) / 2
        : prev
          ? prev.position + 1
          : next
            ? next.position - 1
            : undefined;
    changeTodo(todo, {
      ...(lift.over !== groupOf(todo)
        ? { milestoneId: lift.over === 'none' ? null : lift.over }
        : {}),
      ...(position !== undefined ? { position } : {}),
    });
  };
  /**
   * A name: pressed and pulled up or down, its line goes along; let go unmoved, a click. By touch
   * a long press lifts it (moved before, the page scrolls): carried, it goes along; let go
   * unmoved, its menu opens there – as a long press on a phone.
   */
  const press = (todo: Todo) => ({
    onPointerDown: (event: PointerEvent) => {
      lifted.current = false;
      letGo();
      if (event.button !== 0 || !todo.canEdit) return;
      const from = { id: todo.id, x: event.clientX, y: event.clientY };
      pressed.current = from;
      if (event.pointerType !== 'touch') {
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      hold.current = window.setTimeout(() => {
        hold.current = null;
        pressed.current = null;
        lifted.current = true;
        byTouch.current = true;
        startLift(todo, from.y, from.y);
      }, HOLD_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (lift) return moveLift(event);
      const from = pressed.current;
      if (from?.id !== todo.id) return;
      if (hold.current !== null) {
        // Moved before the press lifted it: scrolling.
        if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > HOLD_SLOP) {
          letGo();
          pressed.current = null;
        }
        return;
      }
      if (Math.abs(event.clientY - from.y) > 4) {
        pressed.current = null;
        // Let go, the name's click is none.
        lifted.current = true;
        startLift(todo, from.y, event.clientY);
      }
    },
    onPointerUp: () => {
      pressed.current = null;
      const touched = byTouch.current;
      letGo();
      if (!lift) return;
      if (touched && Math.abs(lift.dy) <= HOLD_SLOP) {
        setLift(null);
        setMenu({ todo, at: { x: lift.left + names / 2, y: lift.y } });
        return;
      }
      endLift();
    },
    onPointerCancel: cancel,
    onClick: () => {
      if (!lifted.current) onToggle(todo.id);
      lifted.current = false;
    },
  });

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

  // Under each milestone (by date), those without one last; in each, as put there by hand.
  const groups = [
    ...milestones.map((milestone) => ({
      key: milestone.id,
      milestone,
      todos: linesOf(milestone.id),
    })),
    { key: 'none', milestone: null, todos: linesOf('none') },
    // Without one: shown while it has some – or new ones go there.
  ].filter((group) => group.milestone || group.todos.length > 0 || (picked === null && !!onPick));
  /** A milestone new to-dos may go to: the place's they are made in. */
  const pickable = (milestone: TodoMilestone | null) =>
    !!newIn &&
    !!onPick &&
    (!milestone || (milestone.areaId === newIn.areaId && milestone.projectId === newIn.projectId));
  const pick = (key: string, milestone: TodoMilestone | null) => {
    onPick?.(milestone?.id ?? null);
    // Picked, it shows what is in it.
    setShut((now) => (now.has(key) ? new Set([...now].filter((each) => each !== key)) : now));
  };

  // What waits on what, drawn: a line from the blocker's end to the start of each that waits on
  // it – both planned and shown (not in a folded milestone). Where each line's middle stands, by
  // the order drawn: the days' head, then each milestone's line and its lines.
  const middles = new Map<string, number>();
  let top = HEAD;
  for (const group of groups) {
    top += LINE;
    if (shut.has(group.key)) continue;
    for (const todo of group.todos) {
      middles.set(todo.id, top + LINE / 2);
      top += LINE;
    }
  }
  const barOf = (todo: Todo): BarBox | null => {
    const y = middles.get(todo.id);
    const span = preview(todo.id, spanOf(todo));
    if (y === undefined || !span) return null;
    return { y, left: xOf(span[0]) + 2, right: xOf(span[1]) + DAY - 2 };
  };
  const links = todos.flatMap((todo) => {
    const to = barOf(todo);
    if (!to) return [];
    return todo.blockedBy.flatMap((id) => {
      const blocker = byId.get(id);
      const from = blocker && barOf(blocker);
      if (!from) return [];
      // Red where it starts too early; marked from the one open or dragged on to what it holds
      // up, and into it from what it waits on.
      const tone: LinkTone = late.get(todo.id)?.some((one) => one.id === id)
        ? 'late'
        : focus &&
            (todo.id === focus.id || (held.has(todo.id) && (id === focus.id || held.has(id))))
          ? 'marked'
          : 'plain';
      const route = linkRoute(from, to, LINE, LINE / 2 - BAR_INSET);
      const chevrons = chevronsAlong(route, LINK.radius, LINK.spacing, LINK.depth + 6);
      const d = roundedPath(route, LINK.radius);
      return [{ key: `${id}>${todo.id}`, tone, d, chevrons }];
    });
  });

  const width = names + count * DAY;
  const days = Array.from({ length: count }, (_, index) => plus(from, index));
  const nameCell = 'sticky left-0 z-(--z-raised) flex shrink-0 items-center bg-canvas';

  return (
    <section
      aria-label="Zeitplan"
      // Its drags are its own (bars, diamonds, lines drawn on): never the page's selection box.
      data-own-drag
      className="overflow-hidden rounded-panel border border-hairline bg-canvas"
    >
      {/* The line lifted: its name under the pointer, over the place it would go. */}
      {lift && byId.get(lift.id) && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-(--z-popover) flex items-center gap-2 rounded-control bg-canvas pr-3 pl-8 text-sm opacity-90 shadow-lg ring-hairline"
          style={{
            top: lift.y + lift.dy - LINE / 2,
            left: lift.left,
            width: names,
            height: LINE,
          }}
        >
          <StatusMark status={byId.get(lift.id)!.status} />
          <span className="min-w-0 flex-1 truncate text-fg">{byId.get(lift.id)!.title}</span>
          <span className="text-xs text-fg-faint tabular-nums">#{byId.get(lift.id)!.number}</span>
        </div>
      )}
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain">
        <div className="relative" style={{ width }}>
          {/* Weekends: over the lines, but they only lift the canvas to their tone (darken it in
              the light theme) – hairlines, picked lines and bars, already stronger, stay as they
              are; nothing adds up at their edges. Under the sticky names. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-1 mix-blend-lighten [--weekend:color-mix(in_srgb,var(--color-canvas),white_5%)] [[data-theme=light]_&]:mix-blend-darken [[data-theme=light]_&]:[--weekend:color-mix(in_srgb,var(--color-canvas),black_4%)]"
            style={{
              left: names,
              width: count * DAY,
              backgroundImage: `linear-gradient(to right, transparent ${5 * DAY}px, var(--weekend) ${5 * DAY}px)`,
              backgroundSize: `${7 * DAY}px 100%`,
            }}
          />
          {/* Behind every line: today, each milestone's day. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{ left: names, width: count * DAY }}
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

          {/* What waits on what: under the bars and names, over weekends and today. */}
          {links.length > 0 && (
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-y-0 overflow-visible"
              style={{ left: names, width: count * DAY }}
            >
              {/* The chevrons cut out of every band: what lies under shows through. */}
              <defs>
                <mask
                  id={linkId}
                  maskUnits="userSpaceOnUse"
                  x={-1e5}
                  y={-1e5}
                  width={2e5}
                  height={2e5}
                >
                  <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
                  {links.flatMap((link) =>
                    link.chevrons.map((at) => (
                      <path
                        key={`${link.key}@${at.x},${at.y}`}
                        d={`M${-LINK.depth / 2} ${-LINK.width / 2 - 1}L${LINK.depth / 2} 0L${-LINK.depth / 2} ${LINK.width / 2 + 1}`}
                        transform={`translate(${at.x} ${at.y}) rotate(${at.angle})`}
                        fill="none"
                        stroke="black"
                        strokeWidth={LINK.stroke}
                        strokeLinejoin="miter"
                      />
                    )),
                  )}
                </mask>
              </defs>
              {/* One group per tone, the marked and red over the quiet: where lines of a tone run
                  together they stay as one, never darker. One open or dragged: the others step
                  back. */}
              {(['plain', 'marked', 'late'] as const).map((tone) => (
                <g
                  key={tone}
                  mask={`url(#${linkId})`}
                  className="transition-opacity duration-200"
                  style={{
                    stroke: LINK_TONES[tone],
                    opacity: tone === 'plain' ? (focus ? 0.12 : 0.28) : 1,
                  }}
                >
                  {links
                    .filter((link) => link.tone === tone)
                    .map((link) => (
                      <path
                        key={link.key}
                        d={link.d}
                        fill="none"
                        strokeWidth={LINK.width}
                        strokeLinejoin="round"
                      />
                    ))}
                </g>
              ))}
            </svg>
          )}

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
            const lifting = lift ? byId.get(lift.id) : undefined;
            const target = !!lifting && lift?.over === group.key && groupOf(lifting) !== group.key;
            // Where it would go: a line there (not where it stands already).
            const slot =
              lifting && lift?.over === group.key && !staysAt(lifting, lift)
                ? lift.before
                : undefined;
            const slotLine = (edge: string) => (
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-0 z-(--z-chrome) h-0.5 bg-fg',
                  edge,
                )}
              />
            );
            return (
              <div
                key={group.key}
                role="group"
                aria-label={group.milestone?.name ?? 'Ohne Meilenstein'}
                className="relative"
                ref={(box) => {
                  if (box) groupBoxes.current.set(group.key, box);
                  else groupBoxes.current.delete(group.key);
                }}
              >
                {/* Where the line dragged would go. */}
                {target && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-(--z-overlay) bg-selected"
                  />
                )}
                {slot === null && slotLine('bottom-0')}
                <MilestoneLine
                  milestone={group.milestone}
                  picked={pickable(group.milestone) && picked === (group.milestone?.id ?? null)}
                  onPick={
                    pickable(group.milestone) ? () => pick(group.key, group.milestone) : undefined
                  }
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
                    const tooEarly = late.get(todo.id);
                    const marked = linked.has(todo.id);
                    const waitWords = tooEarly
                      ? ` | beginnt, bevor ${tooEarly.map((one) => `#${byId.get(one.id)?.number ?? ''}`).join(', ')} fertig ist`
                      : '';
                    return (
                      <div
                        key={todo.id}
                        data-line={todo.id}
                        className={cn('group/line relative flex')}
                        style={{ height: LINE }}
                        onContextMenu={
                          todo.canEdit
                            ? (event) => {
                                if (event.shiftKey) return;
                                event.preventDefault();
                                // A long press on its name: lifted, its menu once let go unmoved.
                                if (byTouch.current || hold.current !== null) return;
                                setMenu({ todo, at: { x: event.clientX, y: event.clientY } });
                              }
                            : undefined
                        }
                      >
                        {slot === todo.id && slotLine('-top-px')}
                        {/* Lifted: it stays faint where it stands, its name follows the pointer. */}
                        {lift?.id === todo.id && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 z-(--z-overlay) bg-canvas/60"
                          />
                        )}
                        <button
                          type="button"
                          aria-pressed={open}
                          {...press(todo)}
                          title={
                            todo.canEdit
                              ? 'Ziehen, um sie zu verschieben – auch in einen anderen Meilenstein'
                              : undefined
                          }
                          className={cn(
                            nameCell,
                            ROW_MENU_CLASS,
                            'gap-2 border-r border-hairline pr-3 pl-8 text-left text-sm',
                            // Tinted over its canvas, not instead: what scrolls under it never
                            // shows through.
                            !open &&
                              'hover:bg-[linear-gradient(var(--color-hover),var(--color-hover))]',
                            lift?.id === todo.id && 'cursor-grabbing',
                          )}
                          style={{ width: names }}
                        >
                          {/* Picked: over its canvas, so the line scrolled under it never shows through. */}
                          {open && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute inset-0 bg-selected"
                            />
                          )}
                          {/* Its mark where the bar may be scrolled away: red, or held up. */}
                          {(tooEarly || (marked && !open)) && (
                            <span
                              aria-hidden
                              className={cn(
                                'pointer-events-none absolute inset-0',
                                tooEarly ? 'bg-danger/15' : 'bg-accent-blue/10',
                              )}
                            />
                          )}
                          <StatusMark status={todo.status} />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              isOpenTodo(todo.status) ? 'text-fg' : 'text-fg-muted line-through',
                            )}
                          >
                            {todo.title}
                          </span>
                          {tooEarly && (
                            <Icon
                              name="warning"
                              size="sm"
                              label={`Beginnt, bevor ${tooEarly.map((one) => `#${byId.get(one.id)?.number ?? ''}`).join(', ')} fertig ist`}
                              className="shrink-0 text-danger"
                            />
                          )}
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
                              title={`${todo.title} | ${span[0] === span[1] ? dayLabel.format(at(span[1])) : `${dayLabel.format(at(span[0]))} – ${dayLabel.format(at(span[1]))}`}${waitWords}`}
                              className={cn(
                                'absolute top-1.5 bottom-1.5 flex items-center gap-1.5 overflow-hidden rounded-control px-2 text-xs select-none',
                                // Starts before what it waits on is done: red all over.
                                tooEarly
                                  ? 'bg-danger/25 text-fg ring-2 ring-danger'
                                  : todo.status === 'done'
                                    ? 'bg-success/20 text-fg-muted'
                                    : todo.status === 'canceled'
                                      ? 'bg-surface-2 text-fg-faint line-through'
                                      : todo.status === 'in_progress'
                                        ? 'bg-warning/25 text-fg'
                                        : 'bg-surface-3 text-fg',
                                overdue && !tooEarly && 'inset-ring inset-ring-danger/60',
                                !tooEarly && marked && 'ring-2 ring-accent-blue',
                                !tooEarly && open && 'ring-2 ring-fg',
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
          {newIn && (
            <NewMilestone
              names={names}
              areaId={newIn.areaId}
              projectId={newIn.projectId}
              // Made, it is where new to-dos go – those to be put into it come next.
              onMade={(made) => onPick?.(made.id)}
            />
          )}
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
  picked,
  onPick,
  names,
  width,
  folded,
  onFold,
  count,
  lead,
  marker,
}: {
  milestone: TodoMilestone | null;
  /** Where new to-dos go: marked. */
  picked: boolean;
  /** Its name clicked: new ones go here; none (not the place made in): it folds. */
  onPick?: () => void;
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
    <div
      className={cn('group/milestone flex border-t border-hairline', picked && 'bg-surface-2')}
      style={{ height: LINE }}
    >
      <div
        className="sticky left-0 z-(--z-raised) flex shrink-0 items-center gap-1.5 border-r border-hairline bg-canvas pr-1.5 pl-2"
        style={{ width: names }}
      >
        {/* Where new ones go: over its canvas, as a picked line's – and a bar at its edge, that it
            is not taken for the to-do open. */}
        {picked && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-surface-2" />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-fg"
            />
          </>
        )}
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
            picked ? 'text-fg' : milestone ? 'text-fg-muted' : 'text-fg-faint',
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
            onClick={onPick ?? onFold}
            aria-pressed={onPick ? picked : undefined}
            title={
              [
                onPick && (picked ? 'Neue Aufgaben kommen hierher' : 'Neue Aufgaben hierher'),
                milestone?.canEdit && 'Doppelklick: umbenennen',
              ]
                .filter(Boolean)
                .join(' | ') || undefined
            }
            className="relative min-w-0 flex-1 truncate text-left text-sm font-medium text-fg"
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
function NewMilestone({
  names,
  areaId,
  projectId,
  onMade,
}: {
  names: number;
  areaId: string | null;
  projectId: string | null;
  onMade: (milestone: TodoMilestone) => void;
}) {
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
              { name: text, areaId, projectId },
              { onSuccess: onMade, onError: (error) => ui.notify(error.message, 'danger') },
            );
          }}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
        />
      </label>
    </div>
  );
}
