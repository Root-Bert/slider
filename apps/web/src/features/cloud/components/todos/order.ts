import { isOpenTodo, type Todo } from '@slider/shared';

/** What is one's to do: open, one's own or given to one – as the side bar counts. */
export const isMine = (todo: Todo, userId: string) =>
  isOpenTodo(todo.status) && (todo.areaId === null || todo.assignee?.id === userId);

/** Under way first, then by due date (none last), then by priority (none last), then number. */
export const byUrgency = (a: Todo, b: Todo) =>
  Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
  (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') ||
  (a.priority || 5) - (b.priority || 5) ||
  a.number - b.number;
