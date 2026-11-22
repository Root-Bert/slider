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
 * Its priority as a temperature: urgent a flame, high a small one, medium a thermometer half full,
 * low ice, none an empty thermometer.
 */
export function PriorityMark({ priority, size = 14 }: { priority: TodoPriority; size?: number }) {
  if (priority === 1 || priority === 2) {
    return (
      <svg
        viewBox="0 0 14 14"
        width={size}
        height={size}
        aria-hidden
        className={cn('shrink-0', priority === 1 ? 'text-danger' : 'text-warning')}
      >
        {/* High: the same flame, smaller, standing on the same ground. */}
        <g
          transform={
            priority === 2 ? 'translate(7 13.2) scale(0.78) translate(-7 -13.2)' : undefined
          }
        >
          <path
            d="M7 .8c.5 2.3 4.2 3.9 4.2 7.6A4.2 4.2 0 0 1 7 13.2a4.2 4.2 0 0 1-4.2-4.4c.1-1.9 1.2-2.8 1.7-4.2.7 1.1.8 2.1 1.5 2.7C6 5.5 6.2 3.1 7 .8z"
            fill="currentColor"
          />
          <path
            d="M7 7.4c.3 1.2 2 1.9 2 3.6a2 2 0 0 1-4 0c0-.9.5-1.4.8-2 .3.5.4.9.7 1.2.1-1 .2-2 .5-2.8z"
            fill="var(--color-canvas)"
            opacity={0.85}
          />
        </g>
      </svg>
    );
  }
  if (priority === 4) {
    // Ice: a crystal of six arms, each forked at its end.
    return (
      <svg
        viewBox="0 0 14 14"
        width={size}
        height={size}
        aria-hidden
        className="shrink-0 text-sky"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <path key={angle} d="M7 7V1.5M5.6 2.6 7 4l1.4-1.4" transform={`rotate(${angle} 7 7)`} />
          ))}
        </g>
      </svg>
    );
  }
  // Medium: the column half way.
  const column = { 0: 0, 3: 5.8 }[priority];
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden
      className={cn('shrink-0', { 0: 'text-fg-faint', 3: 'text-fg' }[priority])}
    >
      <path
        d="M5.1 8.1V3a1.9 1.9 0 0 1 3.8 0v5.1a3.1 3.1 0 1 1-3.8 0z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      {priority !== 0 && (
        <>
          <circle cx={7} cy={10.6} r={1.7} fill="currentColor" />
          <rect
            x={6.2}
            y={column}
            width={1.6}
            height={10.6 - column}
            rx={0.8}
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
}
