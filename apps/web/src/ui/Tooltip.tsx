import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The bubble's content; several lines go in as block children (`<span>`s stack). */
  label: ReactNode;
  children: ReactNode;
  /** Horizontal anchor above the trigger: centred (default), left edge or right edge. */
  align?: 'center' | 'start' | 'end';
  /** Wraps at 12rem (default) or 16rem; `none` keeps it on one line. */
  maxWidth?: 48 | 64 | 'none';
  /** Also shows while something inside has keyboard focus (default). */
  showOnFocus?: boolean;
  /** Fades and rises in (default); `false` simply appears. */
  animated?: boolean;
  /**
   * The trigger already carries the text (`aria-label`): the bubble is then only visual
   * (`aria-hidden`) instead of `role="tooltip"`.
   */
  decorative?: boolean;
  /** Hides the bubble, e.g. while a popover of the same trigger is open. */
  disabled?: boolean;
  /** Display of the wrapper (which can itself be the chip/avatar box via `className`). */
  display?: 'inline-flex' | 'flex';
}

const alignClasses = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0',
} as const;

const maxWidthClasses = { 48: 'max-w-48', 64: 'max-w-64', none: 'whitespace-nowrap' } as const;

/**
 * Hover (and focus) bubble above its trigger: opaque glass, caption text. CSS only – the wrapper
 * is the `group/tooltip` the bubble reacts to, so it never clashes with a caller's own `group`.
 */
export function Tooltip({
  label,
  children,
  align = 'center',
  maxWidth = 48,
  showOnFocus = true,
  animated = true,
  decorative = false,
  disabled = false,
  display = 'inline-flex',
  className,
  ...props
}: TooltipProps) {
  const id = useId();
  return (
    <span className={cn('group/tooltip relative', display, className)} {...props}>
      {children}
      {!disabled && (
        <span
          id={id}
          role={decorative ? undefined : 'tooltip'}
          aria-hidden={decorative || undefined}
          className={cn(
            'pointer-events-none absolute bottom-full mb-1.5 w-max flex-col rounded-badge',
            'bg-glass-solid px-2 py-1 text-caption leading-4 text-fg shadow-float ring-1 ring-hover',
            alignClasses[align],
            maxWidthClasses[maxWidth],
            animated
              ? [
                  'flex translate-y-1 opacity-0 transition-[opacity,translate] duration-150',
                  'group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100',
                  showOnFocus &&
                    'group-has-focus-visible/tooltip:translate-y-0 group-has-focus-visible/tooltip:opacity-100',
                ]
              : [
                  'hidden group-hover/tooltip:flex',
                  showOnFocus && 'group-has-focus-visible/tooltip:flex',
                ],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
