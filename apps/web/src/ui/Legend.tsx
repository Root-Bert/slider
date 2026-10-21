import type { ReactNode } from 'react';
import { cn } from './cn';

export interface LegendItem {
  key: string;
  label: string;
  value: ReactNode;
  /** A background token class, e.g. `bg-accent-blue`. */
  color: string;
}

export interface LegendProps {
  items: readonly LegendItem[];
  label?: string;
  /** `sm`: caption size in two columns from `sm` on; `md`: body size, one column. */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: { list: 'grid gap-x-4 gap-y-1.5 sm:grid-cols-2', item: 'text-xs', value: 'text-fg-subtle' },
  md: { list: 'flex flex-col gap-2', item: 'text-body', value: 'text-fg' },
} as const;

/** The key under a chart: a dot in each part's colour, its name, its value. */
export function Legend({ items, label, size = 'md', className }: LegendProps) {
  const styles = SIZES[size];
  return (
    <ul aria-label={label} className={cn(styles.list, className)}>
      {items.map((item) => (
        <li key={item.key} className={cn('flex items-center gap-2', styles.item)}>
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', item.color)} />
          <span className="min-w-0 flex-1 truncate text-fg-muted">{item.label}</span>
          <span className={cn('tabular-nums', styles.value)}>{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
