import type { ButtonHTMLAttributes, Ref } from 'react';
import type { AuthorColor } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { cn } from './cn';

export interface CountBubbleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  count: number;
  /** Accent of the first author – the bubble's fill. */
  color: AuthorColor;
  /** Everything in it is resolved: half opacity. */
  dim?: boolean;
  /** sm 20px (on the stage) | md 24px (timeline). */
  size?: 'sm' | 'md';
  /** Required: the number alone does not say what is counted. */
  'aria-label': string;
  ref?: Ref<HTMLButtonElement>;
}

/** Round accent-coloured comment count, e.g. comments in the gap between two slides. */
export function CountBubble({
  count,
  color,
  dim = false,
  size = 'sm',
  className,
  style,
  type = 'button',
  ...props
}: CountBubbleProps) {
  return (
    <button
      type={type}
      className={cn(
        'flex items-center justify-center rounded-full px-1.5 text-caption font-semibold text-white ring-2 ring-canvas transition-[filter] hover:brightness-125',
        size === 'md' ? 'h-6 min-w-6' : 'h-5 min-w-5',
        className,
      )}
      style={{ backgroundColor: accentColor(color), opacity: dim ? 0.5 : 1, ...style }}
      {...props}
    >
      {count}
    </button>
  );
}
