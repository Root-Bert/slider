import type { ReactNode } from 'react';
import { cn, Icon } from '@/ui';

interface SlideThumbnailProps {
  src: string | null;
  /** Show a shimmer instead of the "no preview" icon (slides still rendering). */
  pending?: boolean;
  className?: string;
  /** Overlays (slide-count chip, import progress) positioned inside the frame. */
  children?: ReactNode;
}

/** 16:9 slide preview. Decorative – the surrounding link or heading carries the deck title. */
export function SlideThumbnail({ src, pending = false, className, children }: SlideThumbnailProps) {
  return (
    <div className={cn('relative aspect-video overflow-hidden bg-placeholder', className)}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      ) : pending ? (
        <div className="skeleton size-full" />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-faint">
          <Icon name="description" size={24} />
        </div>
      )}
      {children}
    </div>
  );
}
