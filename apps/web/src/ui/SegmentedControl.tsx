import type { KeyboardEvent } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface Segment<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Shown before the label. */
  icon?: IconName;
  /** Not selectable here, e.g. a feature this browser lacks; `title` says why. */
  disabled?: boolean;
  title?: string;
}

/** xs 20px (segments inside a badge) | sm 28px (composer tabs) | md 32px (filter pills). */
export type SegmentSize = 'xs' | 'sm' | 'md';
export type SegmentTone = 'neutral' | 'warning';

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Kommentare filtern". */
  label: string;
  size?: SegmentSize;
  tone?: SegmentTone;
  /** `soft`: segments sit in a tinted, padded track. `none`: bare (inside a glass pill). */
  track?: 'none' | 'soft';
  /**
   * `radio` (default): a radio group of filter chips. `tabs`: a tab list. Both have roving focus
   * (one Tab stop; arrow keys, Home/End select and focus the next segment, disabled ones are
   * skipped), so the arrows never reach page shortcuts behind it. Disabled tabs stay visible.
   */
  mode?: 'radio' | 'tabs';
  className?: string;
}

/** Track padding/radius per size, concentric with the segment radius (docs §5). */
const trackClasses: Record<SegmentSize, string> = {
  xs: 'gap-0.5 rounded-badge p-0.5',
  sm: 'gap-1 rounded-control p-1',
  md: 'gap-1 rounded-panel p-1',
};

const trackTone: Record<SegmentTone, string> = {
  neutral: 'bg-surface-1',
  warning: 'bg-warning/10',
};

/**
 * Single-select row of segments (e.g. Alle | Offen | Erledigt, or Text | Audio | Video | Bild).
 * Rendered as a radio group or a tab list, so it is keyboard and screen-reader friendly.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  size = 'md',
  tone = 'neutral',
  track = 'none',
  mode = 'radio',
  className,
}: SegmentedControlProps<T>) {
  const tabs = mode === 'tabs';
  const enabled = segments.filter((segment) => !segment.disabled);
  // Roving focus: the selected segment takes Tab; the first enabled one if none is selected.
  const focusable = enabled.some((segment) => segment.value === value) ? value : enabled[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((segment) => segment.value === value);
    // A radio group also moves with ↑/↓ (WAI-ARIA radio group); a horizontal tab list doesn't.
    const forward = event.key === 'ArrowRight' || (!tabs && event.key === 'ArrowDown');
    const backward = event.key === 'ArrowLeft' || (!tabs && event.key === 'ArrowUp');
    let next: number;
    switch (true) {
      case forward:
        next = (index + 1) % enabled.length;
        break;
      case backward:
        next = index <= 0 ? enabled.length - 1 : index - 1;
        break;
      case event.key === 'Home':
        next = 0;
        break;
      case event.key === 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    // Handled: page shortcuts (e.g. the viewer's ←/→ slide navigation) skip prevented keys.
    event.preventDefault();
    const target = enabled[next]!;
    onChange(target.value);
    const chips = event.currentTarget.querySelectorAll<HTMLElement>('[data-segment]');
    [...chips].find((chip) => chip.dataset.segment === target.value)?.focus();
  };

  return (
    <div
      role={tabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center',
        track === 'soft' ? cn('w-fit', trackClasses[size], trackTone[tone]) : 'gap-1',
        className,
      )}
    >
      {segments.map((segment) => (
        <FilterChip
          key={segment.value}
          value={segment.value}
          selected={segment.value === value}
          icon={segment.icon}
          count={segment.count}
          disabled={segment.disabled}
          title={segment.title}
          size={size}
          tone={tone}
          onClick={() => onChange(segment.value)}
          role={tabs ? 'tab' : 'radio'}
          tabIndex={segment.value === focusable ? 0 : -1}
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
  disabled?: boolean | undefined;
  title?: string | undefined;
  onClick: () => void;
  children: string;
  /** `tab`: `aria-selected`, and disabled via `aria-disabled` (stays hoverable for its title). */
  role?: 'radio' | 'checkbox' | 'tab';
  size?: SegmentSize | undefined;
  tone?: SegmentTone | undefined;
  tabIndex?: number | undefined;
  /** Identifies the chip for roving focus (`data-segment`). */
  value?: string | undefined;
}

const sizeClasses: Record<SegmentSize, string> = {
  xs: 'h-5 gap-1 rounded-thumb px-1.5 text-caption font-medium',
  sm: 'h-7 gap-1.5 rounded-chip pr-3 pl-2.5 text-xs font-medium',
  md: 'h-8 gap-1.5 rounded-control px-2.5 text-body',
};

const ICON_PX: Record<SegmentSize, number> = { xs: 14, sm: 16, md: 18 };

const toneClasses: Record<SegmentTone, { selected: string; idle: string }> = {
  neutral: {
    selected: 'bg-selected text-fg',
    idle: 'text-fg-muted hover:bg-hover hover:text-fg',
  },
  warning: {
    selected: 'bg-warning text-on-primary',
    idle: 'text-warning hover:bg-warning/15',
  },
};

/**
 * Filter chip with optional icon and count. Same states as the tool bar's `IconButton`:
 * selected is backed (`bg-selected`), the others stay bare until hover. Sits in a glass pill or a
 * `SegmentedControl` track.
 */
export function FilterChip({
  selected,
  icon,
  count,
  disabled = false,
  title,
  onClick,
  children,
  role = 'checkbox',
  size = 'md',
  tone = 'neutral',
  tabIndex,
  value,
}: FilterChipProps) {
  const tab = role === 'tab';
  const states = toneClasses[tone];
  return (
    <button
      type="button"
      role={role}
      aria-checked={tab ? undefined : selected}
      aria-selected={tab ? selected : undefined}
      aria-disabled={tab && disabled ? true : undefined}
      disabled={tab ? undefined : disabled}
      tabIndex={tab && disabled ? -1 : tabIndex}
      title={title}
      data-segment={value}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap transition-colors',
        sizeClasses[size],
        disabled
          ? 'cursor-not-allowed text-fg-muted opacity-40'
          : selected
            ? cn(states.selected, size === 'md' && 'font-medium')
            : states.idle,
      )}
    >
      {icon && <Icon name={icon} size={ICON_PX[size]} />}
      {children}
      {count !== undefined && (
        <span className={cn('text-xs font-medium', selected ? 'text-fg-muted' : 'text-fg-subtle')}>
          {count}
        </span>
      )}
    </button>
  );
}
