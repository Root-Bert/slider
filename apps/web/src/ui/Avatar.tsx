import type { Author, CommentSource } from '@slider/shared';
import type { ReactNode } from 'react';
import { ringColor } from '@/lib/accent';
import { generatedAvatar } from '@/lib/generated-avatar';
import { GoogleSlidesMark } from './brand/GoogleSlidesMark';
import { cn } from './cn';
import { Icon } from './Icon';

export type AvatarSize = 16 | 18 | 20 | 24 | 28 | 32 | 64;

interface AvatarProps {
  author: Pick<Author, 'name' | 'color' | 'type'>;
  size?: AvatarSize;
  /**
   * Where an imported comment comes from: the small "P" badge for PowerPoint (BER-115), Google
   * Slides' mark for Google comments (BER-157). Absent or `app`: no badge.
   */
  source?: CommentSource;
  /** Native name tooltip; off where the caller shows its own. */
  nativeTitle?: boolean;
  className?: string;
}

/**
 * UI kit "Avatar": circle with a pastel presence ring around a DiceBear avatar seeded by the
 * name, so everyone has one (PowerPoint authors too). A deleted account shows a plain person
 * icon instead – no avatar that could still point to who it was (BER-145).
 */
export function Avatar({
  author,
  size = 24,
  source = 'app',
  nativeTitle = true,
  className,
}: AvatarProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
      title={nativeTitle ? author.name : undefined}
    >
      <span
        className="flex size-full items-center justify-center overflow-hidden rounded-full bg-placeholder"
        style={{ boxShadow: `inset 0 0 0 ${size >= 32 ? 2 : 1.5}px ${ringColor(author.color)}` }}
      >
        {author.type === 'deleted' ? (
          <Icon name="person" size={Math.round(size * 0.66)} className="text-fg-subtle" />
        ) : (
          <img
            src={generatedAvatar(author.name)}
            alt=""
            className="size-full rounded-full object-cover p-px"
            draggable={false}
          />
        )}
      </span>
      {source === 'gslides' && (
        <span
          className="absolute -right-1 -bottom-1 flex items-center justify-center"
          style={{ width: size * 0.6, height: size * 0.6 }}
          role="img"
          aria-label="aus Google Präsentationen"
        >
          <GoogleSlidesMark className="size-full" />
        </span>
      )}
      {source === 'pptx' && (
        <span
          className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-thumb bg-powerpoint text-primary-hover"
          style={{ width: size * 0.6, height: size * 0.6 }}
          role="img"
          aria-label="aus PowerPoint"
        >
          <span className="text-micro leading-none font-semibold">P</span>
        </span>
      )}
    </span>
  );
}

interface AvatarStackProps {
  authors: readonly Author[];
  max?: number;
  size?: AvatarSize;
  /** Hovering an avatar lifts it and shows the name (the "+n" chip lists the rest). */
  interactive?: boolean;
  className?: string;
}

/** UI kit "Avatar Stack": overlapping avatars with a "+n" overflow chip (n ≥ 2). */
export function AvatarStack({
  authors,
  max = 4,
  size = 24,
  interactive = false,
  className,
}: AvatarStackProps) {
  // A "+1" chip takes the slot the one avatar would need: show it instead, the chip starts at "+2".
  const shown = authors.length === max + 1 ? authors.length : max;
  const visible = authors.slice(0, shown);
  const hidden = authors.slice(shown);
  if (authors.length === 0) return null;

  return (
    <span
      className={cn('flex items-center', className)}
      role="img"
      aria-label={authors.map((a) => a.name).join(', ')}
    >
      {visible.map((author, index) => (
        <StackItem
          key={author.id}
          label={author.name}
          interactive={interactive}
          first={index === 0}
        >
          <Avatar
            author={author}
            size={size}
            nativeTitle={!interactive}
            className={cn(index > 0 && 'rounded-full ring-2 ring-canvas')}
          />
        </StackItem>
      ))}
      {hidden.length > 0 && (
        <StackItem label={hidden.map((a) => a.name).join(', ')} interactive={interactive}>
          <AvatarOverflow count={hidden.length} size={size} />
        </StackItem>
      )}
    </span>
  );
}

export interface AvatarOverflowProps {
  /** How many people are not shown. */
  count: number;
  size?: AvatarSize;
  /** Native tooltip, e.g. the hidden names. */
  title?: string;
  /** Layout only (overlap margin); the look comes from the props. */
  className?: string;
}

/** The "+n" chip at the end of an avatar row: opaque raised circle with the count. */
export function AvatarOverflow({ count, size = 24, title, className }: AvatarOverflowProps) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-surface-raised text-tiny font-medium text-fg-muted ring-2 ring-canvas',
        className,
      )}
      style={{ width: size, height: size }}
      title={title}
    >
      +{count}
    </span>
  );
}

function StackItem({
  label,
  interactive,
  first = false,
  children,
}: {
  label: string;
  interactive: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  if (!interactive) return <span className={cn('flex', !first && '-ml-2')}>{children}</span>;
  return (
    <span
      className={cn(
        'group/avatar relative flex transition-transform duration-200 ease-out',
        'hover:z-(--z-raised) hover:-translate-y-1 hover:scale-110',
        !first && '-ml-2',
      )}
    >
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 mb-1.5 w-max max-w-48 -translate-x-1/2 translate-y-1 rounded-badge',
          'bg-glass-solid px-2 py-1 text-caption leading-4 text-fg opacity-0 shadow-lift ring-1 ring-hover',
          'transition-[opacity,translate] duration-150 group-hover/avatar:translate-y-0 group-hover/avatar:opacity-100',
        )}
      >
        {label}
      </span>
    </span>
  );
}
