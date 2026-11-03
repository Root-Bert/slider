import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface SubsectionProps {
  title: string;
  /** Leading mark in the heading, e.g. a provider logo (16–18px). */
  icon?: ReactNode;
  description?: ReactNode;
  /** Right of the heading, e.g. a small "Verbinden" button. */
  aside?: ReactNode;
  /** Layout only (margins, `order-*`). */
  className?: string;
  /** The heading opens and closes the content; closed at first. */
  collapsible?: boolean;
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
  collapsible = false,
  children,
}: SubsectionProps) {
  const headingId = useId();
  const contentId = useId();
  const [open, setOpen] = useState(!collapsible);
  const heading = (
    <>
      {icon}
      {title}
    </>
  );
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={headingId}
            className={cn(
              'text-sm font-semibold text-fg',
              (icon || collapsible) && 'flex items-center gap-2',
            )}
          >
            {collapsible ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={contentId}
                onClick={() => setOpen((now) => !now)}
                className="-ml-1 flex items-center gap-1 rounded-control-sm pr-1.5 text-left hover:text-fg-muted"
              >
                <Icon
                  name={open ? 'expandMore' : 'chevronRight'}
                  size={18}
                  className="shrink-0 text-fg-subtle"
                />
                {heading}
              </button>
            ) : (
              heading
            )}
          </h3>
          {description && <div className="text-sm leading-5 text-fg-subtle">{description}</div>}
        </div>
        {aside}
      </header>
      {collapsible ? (
        <div id={contentId} hidden={!open} className="flex flex-col gap-3">
          {open && children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
