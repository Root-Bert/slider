import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export interface SubsectionProps {
  title: string;
  /** Leading mark in the heading, e.g. a provider logo (16–18px). */
  icon?: ReactNode;
  description?: ReactNode;
  /** Right of the heading, e.g. a small "Verbinden" button. */
  aside?: ReactNode;
  /** Layout only (margins, `order-*`). */
  className?: string;
  children?: ReactNode;
}

/**
 * A group inside a `Section` card: smaller heading (h3), optional explanation, content. Stack
 * them in a `divide-y divide-hairline` column so hidden groups leave no stray rule.
 */
export function Subsection({
  title,
  icon,
  description,
  aside,
  className,
  children,
}: SubsectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={headingId}
            className={cn('text-sm font-semibold text-fg', icon && 'flex items-center gap-2')}
          >
            {icon}
            {title}
          </h3>
          {description && <div className="text-sm leading-5 text-fg-subtle">{description}</div>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
