import { useId } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type SwitchSize = 'sm' | 'md';

/** md 36×20 (settings rows) | sm 28×16 (compact rows). */
const trackSize: Record<SwitchSize, string> = { md: 'h-5 w-9', sm: 'h-4 w-7' };
const knobSize: Record<SwitchSize, { box: string; on: string }> = {
  md: { box: 'size-4', on: 'translate-x-4' },
  sm: { box: 'size-3', on: 'translate-x-3' },
};

function trackClasses(checked: boolean, size: SwitchSize) {
  return cn(
    'relative shrink-0 rounded-badge transition-colors',
    trackSize[size],
    checked ? 'bg-primary' : 'bg-surface-4',
  );
}

function Knob({ checked, size }: { checked: boolean; size: SwitchSize }) {
  return (
    <span
      className={cn(
        'absolute top-0.5 left-0.5 rounded-thumb transition-transform',
        knobSize[size].box,
        checked ? cn(knobSize[size].on, 'bg-on-primary') : 'bg-fg',
      )}
    />
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  /** Settings rows: what the switch is about at a glance – the viewer's icon for the same thing. */
  icon?: IconName;
  disabled?: boolean;
  size?: SwitchSize;
  className?: string;
}

/** UI kit "Toggle": switch with a label row, as used in the share dialog (C1). */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  size = 'md',
  className,
}: ToggleProps) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="flex min-w-0 items-center gap-3">
        {icon && <Icon name={icon} size={20} className="shrink-0 text-fg-muted" />}
        <span className="flex min-w-0 flex-col">
          <span className="text-sm text-fg">{label}</span>
          {description && <span className="text-xs text-fg-subtle">{description}</span>}
        </span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          trackClasses(checked, size),
          'disabled:pointer-events-none disabled:opacity-40',
          checked ? 'hover:bg-primary-hover' : 'hover:bg-fg-faint',
        )}
      >
        <Knob checked={checked} size={size} />
      </button>
    </div>
  );
}
