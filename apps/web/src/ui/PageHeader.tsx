import type { ReactNode } from 'react';
import type { To } from 'react-router';
import { cn } from './cn';
import { BackLink } from './TextLink';

export interface PageHeaderProps {
  /** The page's `<h1>` (28px, `text-display`). */
  title: ReactNode;
  /** Line under (or, `layout="inline"`, next to) the title. */
  subtitle?: ReactNode;
  /** `sm` 14px (setup, onboarding) or `body` 13px (reviews, new review). */
  subtitleSize?: 'sm' | 'body';
  /** "← Zurück zu den Reviews" above the title. */
  back?: { to: To; label?: string };
  /** Left of the title: avatar, workspace mark, icon. */
  leading?: ReactNode;
  /** Right end of the title row. */
  actions?: ReactNode;
  /** One line, cut off with an ellipsis (names that can be long). */
  truncate?: boolean;
  /** `center`: centred block (onboarding welcome). */
  align?: 'start' | 'center';
  /** `inline`: subtitle on the title's baseline, wrapping below on narrow screens (reviews). */
  layout?: 'stacked' | 'inline';
  /** Lays the title's children out in a row, e.g. a breadcrumb "Reviews › Ordner". */
  titleRow?: boolean;
  /** Layout only (page padding); the look comes from the props. */
  className?: string;
}

/** Page title block: optional back link, 28px title with leading/actions, subtitle. */
export function PageHeader({
  title,
  subtitle,
  subtitleSize = 'sm',
  back,
  leading,
  actions,
  truncate = false,
  align = 'start',
  layout = 'stacked',
  titleRow = false,
  className,
}: PageHeaderProps) {
  const centered = align === 'center';
  const heading = (
    <h1
      className={cn(
        'text-display leading-tight font-semibold tracking-tight text-fg',
        titleRow && 'flex min-w-0 items-center gap-1.5',
        truncate && 'min-w-0 truncate',
      )}
    >
      {title}
    </h1>
  );
  const titleLine =
    leading || actions ? (
      <div className="flex items-center gap-3">
        {leading}
        {heading}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    ) : (
      heading
    );

  const block = subtitle ? (
    <hgroup
      className={cn(
        layout === 'inline'
          ? 'flex flex-wrap items-baseline gap-x-3 gap-y-1'
          : cn('flex flex-col', centered ? 'gap-2' : 'gap-1'),
        centered && 'items-center text-center',
        !back && className,
      )}
    >
      {titleLine}
      <p className={cn(subtitleSize === 'body' ? 'text-body' : 'text-sm', 'text-fg-subtle')}>
        {subtitle}
      </p>
    </hgroup>
  ) : back ? (
    titleLine
  ) : (
    <div className={cn(centered && 'flex flex-col items-center text-center', className)}>
      {titleLine}
    </div>
  );

  if (!back) return block;
  return (
    <div className={cn('flex flex-col gap-3', centered && 'items-center', className)}>
      <BackLink to={back.to} label={back.label} />
      {block}
    </div>
  );
}
