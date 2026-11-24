import type { TodoPriority, TodoStatus } from '@slider/shared';
import { cn } from '@/ui';

/**
 * A to-do's status as a box, as the calendars' boxes beside the calendar: empty (to do), a
 * dash in it (backlog: parked), filling from below (in progress), filled with a tick (done),
 * struck through (dropped).
 */
export function StatusMark({ status, size = 14 }: { status: TodoStatus; size?: number }) {
  const tone = {
    backlog: 'text-fg-faint',
    todo: 'text-fg-muted',
    in_progress: 'text-warning',
    done: 'text-success',
    canceled: 'text-fg-faint',
  }[status];
  const filled = status === 'done';
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden
      className={cn('shrink-0', tone)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {filled ? (
        <rect x={1} y={1} width={12} height={12} rx={3.5} fill="currentColor" stroke="none" />
      ) : (
        <rect x={1.75} y={1.75} width={10.5} height={10.5} rx={3} />
      )}
      {status === 'backlog' && <path d="M5 7h4" />}
      {status === 'in_progress' && (
        <path d="M1.75 7.5h10.5v1.75a3 3 0 0 1-3 3h-4.5a3 3 0 0 1-3-3z" fill="currentColor" />
      )}
      {status === 'done' && (
        <path d="M4.3 7.3l1.9 1.9 3.6-4" stroke="var(--color-canvas)" strokeWidth={1.6} />
      )}
      {status === 'canceled' && <path d="M4.5 9.5l5-5" />}
    </svg>
  );
}

/**
 * Its priority as Jira's and Linear's marks: low a flat line, medium a roof (both plain grey),
 * high a double roof, urgent a filled box with „!“; none three faint dashes.
 */
export function PriorityMark({ priority, size = 14 }: { priority: TodoPriority; size?: number }) {
  const tone = {
    0: 'text-fg-faint',
    1: 'text-danger',
    2: 'text-warning',
    3: 'text-fg-muted',
    4: 'text-fg-muted',
  }[priority];
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden
      className={cn('shrink-0', tone)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {priority === 0 && <path d="M2 7h1.5M6.25 7h1.5M10.5 7H12" />}
      {priority === 4 && <path d="M2.5 7h9" />}
      {priority === 3 && <path d="M2.5 9.25 7 4.75l4.5 4.5" />}
      {priority === 2 && <path d="M2.5 7.5 7 3l4.5 4.5M2.5 11.5 7 7l4.5 4.5" />}
      {priority === 1 && (
        <>
          <rect x={1} y={1} width={12} height={12} rx={3.5} fill="currentColor" stroke="none" />
          <path d="M7 3.9v3.9" stroke="var(--color-canvas)" strokeWidth={1.8} />
          <circle cx={7} cy={10.1} r={1} fill="var(--color-canvas)" stroke="none" />
        </>
      )}
    </svg>
  );
}
