import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone =
  'success' | 'warning' | 'info' | 'danger' | 'powerpoint' | 'neutral' | 'overlay';

/** UI kit "Badge": 20px pill, 10 % tinted background, coloured medium 11px text. */
const toneClasses: Record<BadgeTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  danger: 'bg-danger/10 text-danger',
  powerpoint: 'bg-powerpoint/10 text-powerpoint',
  neutral: 'bg-hover text-fg-muted',
  /** Over a slide or thumbnail: dark frosted chip; full `fg` so it reads over bright slides. */
  overlay: 'glass-dark text-fg',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /**
   * A single icon or mark in a 24px square chip (origin logos on a thumbnail). Give it an
   * accessible name (`aria-label` or a labelled icon) or a `title`.
   */
  iconOnly?: boolean;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  iconOnly = false,
  children,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap',
        iconOnly
          ? 'size-6 justify-center rounded-chip'
          : 'h-5 gap-1 rounded-badge px-2 text-caption leading-3.5 font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
