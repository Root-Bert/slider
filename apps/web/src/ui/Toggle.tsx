import { useId } from 'react';
import { cn } from './cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

/** UI kit "Toggle": switch with a label row, as used in the share dialog (C1). */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="flex min-w-0 flex-col">
        <span className="text-sm text-fg">{label}</span>
        {description && <span className="text-xs text-fg-subtle">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40',
          checked ? 'bg-primary' : 'bg-white/20',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full transition-transform',
            checked ? 'translate-x-4 bg-black' : 'bg-white/80',
          )}
        />
      </button>
    </div>
  );
}
