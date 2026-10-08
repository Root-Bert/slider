import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Shown before the label. */
  icon?: IconName;
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
 * Single-select row of filter chips (e.g. Alle · Offen · Erledigt).
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
          icon={segment.icon}
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
  icon?: IconName | undefined;
  count?: number | undefined;
  onClick: () => void;
  children: string;
  role?: 'radio' | 'checkbox';
}

/**
 * 32px filter chip with optional icon and count. Same states as the tool bar's `IconButton`:
 * selected is backed (`white/15`), the others stay bare until hover. Sits in a glass pill.
 */
export function FilterChip({
  selected,
  icon,
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
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[13px] whitespace-nowrap transition-colors',
        selected
          ? 'bg-white/15 font-medium text-fg'
          : 'text-fg-muted hover:bg-white/10 hover:text-fg',
      )}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
      {count !== undefined && (
        <span className={cn('text-xs font-medium', selected ? 'text-fg-muted' : 'text-fg-subtle')}>
          {count}
        </span>
      )}
    </button>
  );
}
