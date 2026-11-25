import { isOpenTodo, type Todo, type TodoMilestone } from '@slider/shared';
import { at, iso, plus, startOfWeek } from '../calendar/days';

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
