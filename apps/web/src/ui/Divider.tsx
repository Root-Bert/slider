import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface DividerProps extends HTMLAttributes<HTMLElement> {
  /** A word in the line, e.g. "oder". Without it: a plain 1px hairline rule. */
  label?: ReactNode;
  /** Where the label sits: between two lines (`center`, default) or before one (`start`). */
  labelPosition?: 'center' | 'start';
}

/**
 * Horizontal rule. Without a label a `role="separator"` hairline; with one a text row
 * ("— oder —") whose lines are decorative, so the word itself is read.
 */
export function Divider({ label, labelPosition = 'center', className, ...props }: DividerProps) {
  if (label === undefined || label === null || label === false) {
    return <div role="separator" className={cn('h-px bg-hairline', className)} {...props} />;
  }
  const line = <span aria-hidden className="h-px flex-1 bg-hairline" />;
  return (
    <p className={cn('flex items-center gap-3 text-xs text-fg-subtle', className)} {...props}>
      {labelPosition === 'center' && line}
      {label}
      {line}
    </p>
  );
}
