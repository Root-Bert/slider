import type { Todo, TodoMilestone } from '@slider/shared';
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
