import { generatedLandscape } from '@/lib/generated-avatar';
import { cn } from '@/ui';

/**
 * Square mark of a workspace (boxy, like the rest of the app – not a circle): its uploaded logo,
 * else a DiceBear landscape seeded by its name (as people without a photo get a DiceBear avatar).
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
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-3',
        size === 24
          ? 'rounded-badge'
          : size === 32
            ? 'rounded-chip'
            : size === 40
              ? 'rounded-control-sm'
              : 'rounded-control',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={logoUrl || generatedLandscape(name)}
        alt=""
        draggable={false}
        className={cn('size-full', logoUrl ? 'object-contain' : 'object-cover')}
      />
    </span>
  );
}
