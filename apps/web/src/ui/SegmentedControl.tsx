import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Shown before the label in the `tool` variant. */
  icon?: IconName;
}

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Kommentare filtern". */
  label: string;
  /**
   * `chip`: UI kit "Chip / Filter" (selected = white fill, others glass).
   * `tool`: like the viewer's tool bar – only the selected item is backed; sits in a glass pill.
   */
  variant?: 'chip' | 'tool';
  className?: string;
}

/**
 * Single-select row of items (e.g. Alle · Offen · Erledigt).
 * Rendered as a radio group so it is keyboard and screen-reader friendly.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  variant = 'chip',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex items-center gap-1', className)}>
      {segments.map((segment) =>
        variant === 'tool' ? (
          <ToolSegment
            key={segment.value}
            segment={segment}
            selected={segment.value === value}
            onClick={() => onChange(segment.value)}
          />
        ) : (
          <FilterChip
            key={segment.value}
            selected={segment.value === value}
            count={segment.count}
            onClick={() => onChange(segment.value)}
            role="radio"
          >
            {segment.label}
          </FilterChip>
        ),
      )}
    </div>
  );
}

/** Same states as `IconButton` in the tool bar: selected `white/15`, others bare until hover. */
function ToolSegment<T extends string>({
  segment,
  selected,
  onClick,
}: {
  segment: Segment<T>;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-[13px] whitespace-nowrap transition-colors',
        selected
          ? 'bg-white/15 font-medium text-fg'
          : 'text-fg-muted hover:bg-white/10 hover:text-fg',
      )}
    >
      {segment.icon && <Icon name={segment.icon} size={18} />}
      {segment.label}
      {segment.count !== undefined && (
        <span className={cn('text-xs font-medium', selected ? 'text-fg-muted' : 'text-fg-subtle')}>
          {segment.count}
        </span>
      )}
    </button>
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
        'inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-[13px] whitespace-nowrap transition-colors',
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
