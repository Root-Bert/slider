import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface SectionProps {
  /** Anchor for links into the page, e.g. `#einladen`. */
  id?: string;
  title: string;
  /** Leading icon in the heading (20px, muted), e.g. the onboarding cards. */
  icon?: IconName;
  description?: ReactNode;
  /** Right of the heading, e.g. a count or an action. */
  aside?: ReactNode;
  /** `danger`: red heading and a subtle red edge (leave / delete). */
  tone?: 'default' | 'danger';
  /** `compact`: tighter card (gap 16, padding 24) – the onboarding cards. */
  density?: 'default' | 'compact';
  /** Layout only (`order-*`, margins); the look comes from the props. */
  className?: string;
  /** Optional: a section can be just a heading with an aside. */
  children?: ReactNode;
}

/** A settings card: heading, short explanation, content (workspace, account, setup pages). */
export function Section({
  id,
  title,
  icon,
  description,
  aside,
  tone = 'default',
  density = 'default',
  className,
  children,
}: SectionProps) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'glass flex scroll-mt-4 flex-col rounded-panel',
        density === 'compact' ? 'gap-4 p-6' : 'gap-5 p-5 sm:p-6',
        // `inset-ring` replaces the glass hairline with the danger edge (it comes later in the css).
        tone === 'danger' && 'inset-ring inset-ring-danger/30',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={headingId}
            className={cn(
              'text-base font-semibold',
              icon && 'flex items-center gap-2',
              tone === 'danger' ? 'text-danger' : 'text-fg',
            )}
          >
            {icon && <Icon name={icon} size={20} className="text-fg-muted" />}
            {title}
          </h2>
          {description && <div className="text-body leading-5 text-fg-subtle">{description}</div>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
