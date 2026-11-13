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
  /**
   * `below` on phones: a wide aside (a segmented control) goes under the heading there instead of
   * squeezing it; from `sm` on it stays to the right.
   */
  asideOnPhones?: 'right' | 'below';
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
  asideOnPhones = 'right',
  tone = 'default',
  density = 'default',
  className,
  children,
}: SectionProps) {
  const headingId = useId();
  const heading = (
    <h2
      id={headingId}
      className={cn(
        'text-base font-semibold',
        asideOnPhones === 'right' && 'max-sm:self-center',
        icon && 'flex items-center gap-2',
        tone === 'danger' ? 'text-danger' : 'text-fg',
      )}
    >
      {icon && <Icon name={icon} size={20} className="text-fg-muted" />}
      {title}
    </h2>
  );
  const text = description && (
    <div className="text-body leading-5 text-fg-subtle">{description}</div>
  );
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
      {asideOnPhones === 'below' ? (
        <header className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {heading}
            {text}
          </div>
          {aside}
        </header>
      ) : (
        // On phones the aside sits beside the heading and the explanation takes the full width
        // under both – not squeezed into a column beside a button; from `sm` on, the aside is
        // right of heading and explanation.
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
          {heading}
          {aside && <div className="col-[2] row-[1] max-sm:self-center sm:row-[1/3]">{aside}</div>}
          {description && <div className="col-[1/-1] sm:col-[1]">{text}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
