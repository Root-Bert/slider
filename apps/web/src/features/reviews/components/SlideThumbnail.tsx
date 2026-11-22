import type { ReactNode } from 'react';
import { cn, Icon } from '@/ui';

interface SlideThumbnailProps {
  src: string | null;
  /** Show a shimmer instead of the "no preview" icon (slides still rendering). */
  pending?: boolean;
  /** Soft halo in the slide's own colours: a blurred copy of the image behind the frame. */
  glow?: boolean;
  /** Halo state classes (hover, focus) – the card decides what counts as hovering it. */
  glowClassName?: string;
  className?: string;
  /** Overlays (slide-count chip, import progress) positioned inside the frame. */
  children?: ReactNode;
}

/** 16:9 slide preview. Decorative – the surrounding link or heading carries the deck title. */
export function SlideThumbnail({ glow = false, glowClassName, ...props }: SlideThumbnailProps) {
  if (!glow || !props.src) return <ThumbnailFrame {...props} />;
  return (
    <div className="relative isolate">
      {/* Blur sits on a padded wrapper, not the image: browsers clip a composited filter to the
          element's own box (the halo only showed after a forced repaint, e.g. a screenshot).
          Only its opacity ever changes: the blurred picture is painted once and then just faded –
          scaling it re-blurred it every frame (stutter) and repainted it at the end (jump), and a
          layer kept per card for that ran short with many cards. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -inset-10 -z-(--z-raised) p-10 opacity-30 blur-xl',
          'transition-opacity duration-200',
          glowClassName,
        )}
      >
        {/* Lazy like the frame: an eager copy would fetch every card's thumbnail on load. */}
        <img
          src={props.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      </div>
      <ThumbnailFrame {...props} />
    </div>
  );
}

function ThumbnailFrame({ src, pending = false, className, children }: SlideThumbnailProps) {
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
