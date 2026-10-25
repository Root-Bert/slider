import type { ReactNode } from 'react';

/**
 * A workspace one can join right away, as a wide card on the welcome page: mark, name with
 * a badge, details and "Beitreten". The company of one's domain gets a `FeaturedJoinCard`; the
 * switcher menu uses compact rows.
 */
export function JoinCard({
  leading,
  title,
  badge,
  subtitle,
  action,
}: {
  leading: ReactNode;
  title: ReactNode;
  /** Next to the title, e.g. the role of an invitation. */
  badge?: ReactNode;
  subtitle?: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 rounded-panel bg-surface-1 px-5 py-4">
      <span className="flex shrink-0">{leading}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-medium text-fg">{title}</span>
          {badge}
        </span>
        {subtitle !== undefined && (
          <span className="truncate text-sm text-fg-subtle">{subtitle}</span>
        )}
      </span>
      {action}
    </li>
  );
}
