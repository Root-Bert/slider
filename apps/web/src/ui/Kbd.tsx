import type { ReactNode } from 'react';
import { cn } from './cn';

/** Keyboard shortcut hint, e.g. "⌘K" in the search field. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-badge px-1.5 font-sans text-[11px] text-fg-subtle',
        'shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
