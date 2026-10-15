import type { ReactNode } from 'react';
import { cn } from './cn';

/** Keyboard shortcut hint, e.g. "⌘K" in the search field. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-badge px-1.5 font-sans text-[11px] leading-none font-normal text-fg-subtle',
        'shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** The return key (↵) as a glyph – the font's arrow sits too small and low next to ⌘. */
export function ReturnKey() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Enter"
      role="img"
    >
      <path d="M10 2.5v3.5a1.5 1.5 0 0 1-1.5 1.5H2.5M5 5 2.5 7.5 5 10" />
    </svg>
  );
}
