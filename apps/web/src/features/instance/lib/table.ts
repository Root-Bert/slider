import { cn } from '@/ui';

export interface Column {
  label: string;
  /** Numbers right-aligned, so their digits line up. */
  numeric?: boolean;
  /** e.g. `max-md:hidden` for a column phones can do without. */
  className?: string;
  /** Read by screen readers only (the actions column). */
  hidden?: boolean;
}

/** Cell classes, matching the header's columns. */
export const cell = (column: Column) =>
  cn(
    'px-3 py-2.5 align-middle',
    column.numeric ? 'text-right tabular-nums text-fg-muted' : 'text-left',
    column.className,
  );

export const ROW_CLASS =
  'border-b border-hairline last:border-b-0 transition-colors hover:bg-surface-1';
