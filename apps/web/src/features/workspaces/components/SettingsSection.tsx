import { useId, type ReactNode } from 'react';
import { cn } from '@/ui';

/** A card on the workspace settings page: heading, short explanation, content. */
export function SettingsSection({
  id,
  title,
  description,
  aside,
  tone = 'default',
  children,
}: {
  /** Anchor for links into the page, e.g. `#einladen`. */
  id?: string;
  title: string;
  description?: ReactNode;
  /** Right of the heading, e.g. a count or an action. */
  aside?: ReactNode;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'glass flex scroll-mt-4 flex-col gap-5 rounded-panel p-5 sm:p-6',
        tone === 'danger' && 'shadow-[inset_0_0_0_1px_rgb(255_59_48/0.25)]',
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={headingId}
            className={cn('text-base font-semibold', tone === 'danger' ? 'text-danger' : 'text-fg')}
          >
            {title}
          </h2>
          {description && <div className="text-[13px] leading-5 text-fg-subtle">{description}</div>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
