import { cn } from './cn';

interface ProgressBarProps {
  /** 0–1; `null` renders an indeterminate bar. */
  value: number | null;
  label: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className={cn('h-1 overflow-hidden rounded-full bg-white/10', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-fg transition-[width] duration-300',
          percent === null && 'skeleton w-full',
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
