import { cn } from '@/ui';

/**
 * Square mark of a workspace (boxy, like the rest of the app – not a circle): its uploaded logo,
 * else a monogram.
 */
export function WorkspaceMark({
  name,
  logoUrl,
  size = 24,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: 24 | 32 | 40 | 64;
  className?: string;
}) {
  const letter = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-3 font-semibold text-fg',
        size === 24
          ? 'rounded-badge text-caption'
          : size === 32
            ? 'rounded-chip text-body'
            : size === 40
              ? 'rounded-control-sm text-sm'
              : 'rounded-control text-2xl',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        letter
      )}
    </span>
  );
}
