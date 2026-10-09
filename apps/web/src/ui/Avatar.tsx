import type { Author } from '@slider/shared';
import { ringColor } from '@/lib/accent';
import { generatedAvatar } from '@/lib/generated-avatar';
import { cn } from './cn';

type AvatarSize = 16 | 18 | 20 | 24 | 32 | 64;

interface AvatarProps {
  author: Pick<Author, 'name' | 'color' | 'avatarUrl' | 'avatarSeed' | 'type'>;
  size?: AvatarSize;
  /** Shows the small PowerPoint badge for comments imported from the PPTX (BER-115). */
  showPowerPointBadge?: boolean;
  className?: string;
}

/**
 * UI kit "Avatar": circle with a pastel presence ring. A re-rolled avatar wins; otherwise the
 * photo, and without one a DiceBear avatar seeded by the name.
 */
export function Avatar({ author, size = 24, showPowerPointBadge = false, className }: AvatarProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
      title={author.name}
    >
      <span
        className="flex size-full items-center justify-center overflow-hidden rounded-full bg-placeholder"
        style={{ boxShadow: `inset 0 0 0 ${size >= 32 ? 2 : 1.5}px ${ringColor(author.color)}` }}
      >
        <img
          src={
            author.avatarSeed
              ? generatedAvatar(author.avatarSeed)
              : (author.avatarUrl ?? generatedAvatar(author.name))
          }
          alt=""
          className="size-full rounded-full object-cover p-px"
          draggable={false}
        />
      </span>
      {showPowerPointBadge && (
        <span
          className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-thumb bg-powerpoint text-white"
          style={{ width: size * 0.6, height: size * 0.6 }}
          aria-label="aus PowerPoint"
        >
          <span className="text-[8px] leading-none font-semibold">P</span>
        </span>
      )}
    </span>
  );
}

interface AvatarStackProps {
  authors: readonly Author[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}

/** UI kit "Avatar Stack": overlapping avatars with a "+n" overflow chip. */
export function AvatarStack({ authors, max = 4, size = 24, className }: AvatarStackProps) {
  const visible = authors.slice(0, max);
  const overflow = authors.length - visible.length;
  if (authors.length === 0) return null;

  return (
    <span
      className={cn('flex items-center', className)}
      aria-label={authors.map((a) => a.name).join(', ')}
    >
      {visible.map((author, index) => (
        <Avatar
          key={author.id}
          author={author}
          size={size}
          className={cn(index > 0 && '-ml-2 rounded-full ring-2 ring-canvas')}
        />
      ))}
      {overflow > 0 && (
        <span
          className="-ml-2 flex items-center justify-center rounded-full bg-[#2a2a2a] text-[10px] font-medium text-fg-muted ring-2 ring-canvas"
          style={{ width: size, height: size }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

export function PowerPointMark({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-badge bg-powerpoint font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-label="PowerPoint"
    >
      P
    </span>
  );
}
