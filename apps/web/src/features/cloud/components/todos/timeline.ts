import { isOpenTodo, type Todo, type TodoMilestone } from '@slider/shared';
import { at, iso, plus, startOfWeek } from '../calendar/days';

/** A bar on the timeline: its line's middle, its left and right edge (px). */
export interface BarBox {
  y: number;
  left: number;
  right: number;
}

/**
 * The way a line from what one waits on to it runs (as Gantt charts draw them): out of the
 * blocker's end a stub to the right, then down (or up) and into its start from the left. Starting
 * right after it (too close to come in from the left), in from above or below where the stub
 * stands; starting before its end, round – out, along between the two lines, back left of its
 * start, in. `half`: half a bar's height, `stub`: the stub's length.
 */
export function linkRoute(
  from: BarBox,
  to: BarBox,
  line: number,
  half: number,
  stub = 10,
): { x: number; y: number }[] {
  const out = from.right + stub;
  const down = to.y > from.y ? 1 : -1;
  if (to.left >= out + stub)
    return [
      { x: from.right, y: from.y },
      { x: out, y: from.y },
      { x: out, y: to.y },
      { x: to.left, y: to.y },
    ];
  if (to.left > from.right && to.right >= out + 4)
    return [
      { x: from.right, y: from.y },
      { x: out, y: from.y },
      { x: out, y: to.y - down * half },
    ];
  const gap = from.y + (down * line) / 2;
  return [
    { x: from.right, y: from.y },
    { x: out, y: from.y },
    { x: out, y: gap },
    { x: to.left - stub, y: gap },
    { x: to.left - stub, y: to.y },
    { x: to.left, y: to.y },
  ];
}

/**
 * Where a line's chevrons stand (their middle, the way they point in degrees): along its straight
 * runs every `spacing` px, counted from each run's start – so two lines going the same way out of
 * one bar share theirs –, `room` px clear of its ends and of each round corner (`radius`). A line
 * too short for any has one in the middle of its longest run.
 */
export function chevronsAlong(
  points: readonly { x: number; y: number }[],
  radius: number,
  spacing: number,
  room: number,
): { x: number; y: number; angle: number }[] {
  const found: { x: number; y: number; angle: number }[] = [];
  let longest = { length: -1, at: 0 };
  const last = points.length - 2;
  for (let index = 0; index <= last; index++) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    if (length > longest.length) longest = { length, at: index };
    const [ux, uy] = [(b.x - a.x) / length, (b.y - a.y) / length];
    const angle = Math.round((Math.atan2(uy, ux) * 180) / Math.PI);
    const end = length - (index === last ? room : radius + room);
    for (let along = index === 0 ? room : radius + room; along <= end; along += spacing)
      found.push({ x: a.x + ux * along, y: a.y + uy * along, angle });
  }
  if (found.length || longest.length < 0) return found;
  const a = points[longest.at]!;
  const b = points[longest.at + 1]!;
  const angle = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle }];
}

/** Whole days from one noon to another. */
export const between = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

/** From a week before the first date to two after the last – ten weeks at least, from a Monday. */
export function rangeOf(
  todos: readonly Pick<Todo, 'startOn' | 'dueOn'>[],
  milestones: readonly Pick<TodoMilestone, 'dueOn'>[],
  today: Date,
) {
  const days = [
    iso(today),
    ...todos.flatMap((todo) => [todo.startOn, todo.dueOn]),
    ...milestones.map((milestone) => milestone.dueOn),
  ]
    .filter((day): day is string => !!day)
    .sort();
  const from = startOfWeek(plus(at(days[0]!), -7));
  const last = plus(startOfWeek(plus(at(days.at(-1)!), 14)), 6);
  return { from, count: Math.max(between(from, last) + 1, 70) };
}

/** Its bar: from its start to its due day – either alone is one day; none, no bar. */
export function spanOf(todo: Pick<Todo, 'startOn' | 'dueOn'>): [string, string] | null {
  const a = todo.startOn ?? todo.dueOn;
  const b = todo.dueOn ?? todo.startOn;
  if (!a || !b) return null;
  return a <= b ? [a, b] : [b, a];
}

type Linked = Pick<Todo, 'id' | 'status' | 'blockedBy'>;

/** Those that wait on it, however far round – what moving it holds up. */
export function heldUpBy(todos: readonly Linked[], id: string): Set<string> {
  const found = new Set<string>();
  const next = [id];
  while (next.length) {
    const at = next.pop()!;
    for (const todo of todos)
      if (todo.blockedBy.includes(at) && !found.has(todo.id) && todo.id !== id) {
        found.add(todo.id);
        next.push(todo.id);
      }
  }
  return found;
}

/**
 * Those that start too early: on or before the due day of an open one they wait on (bars cover
 * whole days). Done or dropped, neither counts; one without dates neither. `spanFor`: as it stands
 * – while dragged, where it is being dragged to.
 */
export function startingTooEarly(
  todos: readonly Linked[],
  spanFor: (id: string) => [string, string] | null,
): Map<string, Linked[]> {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const late = new Map<string, Linked[]>();
  for (const todo of todos) {
    const own = isOpenTodo(todo.status) ? spanFor(todo.id) : null;
    if (!own) continue;
    const before = todo.blockedBy.flatMap((id) => {
      const blocker = byId.get(id);
      const span = blocker && isOpenTodo(blocker.status) ? spanFor(id) : null;
      return blocker && span && own[0] <= span[1] ? [blocker] : [];
    });
    if (before.length) late.set(todo.id, before);
  }
  return late;
}
