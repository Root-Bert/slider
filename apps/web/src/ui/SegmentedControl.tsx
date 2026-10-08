import { cn } from './cn';

export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Kommentare filtern". */
  label: string;
  className?: string;
}

/**
 * Row of UI kit "Chip / Filter" items acting as a single-select (e.g. Alle · Offen · Erledigt).
 * Rendered as a radio group so it is keyboard and screen-reader friendly.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-center gap-1', className)}>
      {segments.map((segment) => (
        <FilterChip
          key={segment.value}
          selected={segment.value === value}
          count={segment.count}
          onClick={() => onChange(segment.value)}
          role="radio"
        >
          {segment.label}
        </FilterChip>
      ))}
    </div>
  );
}

interface FilterChipProps {
  selected: boolean;
  count?: number | undefined;
  onClick: () => void;
  children: string;
  role?: 'radio' | 'checkbox';
}

/** UI kit "Chip / Filter": 32px chip with optional count. Selected = white 90 % fill. */
export function FilterChip({
  selected,
  count,
  onClick,
  children,
  role = 'checkbox',
}: FilterChipProps) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-chip px-3 text-[13px] whitespace-nowrap transition-colors',
        selected ? 'bg-primary font-medium text-on-primary' : 'glass text-fg-muted hover:text-fg',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('text-xs font-medium', selected ? 'text-black/50' : 'text-fg-subtle')}>
          {count}
        </span>
      )}
    </button>
  );
}
