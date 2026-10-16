import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export interface ErrorTextProps extends HTMLAttributes<HTMLParagraphElement> {
  /** `body` 13px for a failed list or card, `xs` 12px under a field or composer. */
  size?: 'body' | 'xs';
}

/** Inline error message in the danger colour, e.g. a query's `error.message`. */
export function ErrorText({ size = 'body', className, ...props }: ErrorTextProps) {
  return (
    <p
      className={cn(size === 'xs' ? 'text-xs' : 'text-body', 'text-danger', className)}
      {...props}
    />
  );
}
