import { cn } from '@/ui';

/** Square monogram of a workspace (boxy, like the rest of the app – not a circle). */
export function WorkspaceMark({
  name,
  size = 24,
  className,
}: {
  name: string;
  size?: 24 | 32 | 40;
  className?: string;
}) {
  const letter = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-white/12 font-semibold text-fg',
        size === 24
          ? 'rounded-badge text-[11px]'
          : size === 32
            ? 'rounded-chip text-[13px]'
            : 'rounded-control-sm text-sm',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {letter}
    </span>
  );
}
