import type { AccentColor, Slide } from '@slider/shared';
import { memo, useRef, useState } from 'react';
import { Badge, cn, Icon } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { slideLabel } from '../lib/labels';
import type { SlideBadge } from '../lib/revision-changes';
import { ChangeBadge } from '../revisions/ChangeBadge';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerDispatch, type Draft, type Tool } from '../state/viewer-state';
import { AnnotationLayer } from './AnnotationLayer';
import { DrawingSurface } from './DrawingSurface';

/** Below this width the slide shows its thumbnail image and small corners. */
const THUMB_MAX_W = 320;

interface SlideFrameProps {
  slide: Slide;
  index: number;
  total: number;
  /** Position in the track (px) – the box is absolutely positioned. */
  x: number;
  top: number;
  w: number;
  h: number;
  isActive: boolean;
  /** Threads of this slide that pass the filter. */
  threads: Thread[];
  /** Focused or hovered thread – only set when it belongs to this slide. */
  emphasisId: string | null;
  /** The draft – only set when it is on this slide. */
  draft: Draft | null;
  /** Active tool, `null` when not drawing or not allowed to comment. */
  tool: Tool | null;
  color: AccentColor;
  /** Change of the latest revision – only set while changes are shown (Figma D2). */
  badge: SlideBadge | null;
  /** The revision the badge belongs to ("Geändert · V4"). */
  badgeVersion: number;
}

/**
 * One slide in the timeline track: image, annotation overlay and – on the active slide while a
 * tool is selected – the drawing surface. Clicking a slide makes it the active one.
 */
export const SlideFrame = memo(function SlideFrame({
  slide,
  index,
  total,
  x,
  top,
  w,
  h,
  isActive,
  threads,
  emphasisId,
  draft,
  tool,
  color,
  badge,
  badgeVersion,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const registry = useStageRegistry();
  const dispatch = useViewerDispatch();
  const [loaded, setLoaded] = useState(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  const drawing = isActive && tool !== null;

  const activate = () => {
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    registry.revealSlide(slide.id, { align: 'nearest' });
  };

  return (
    <div
      data-slide-id={slide.id}
      role="group"
      aria-roledescription="Folie"
      aria-label={`${label} von ${total}${slide.title ? `: ${slide.title}` : ''}`}
      aria-current={isActive || undefined}
      className={cn(
        'absolute snap-start transition-shadow',
        small ? 'rounded-thumb' : 'rounded-panel',
        // Filmstrip style: 2px white frame outside the image, a thin black line inside.
        isActive && 'shadow-[0_0_0_2px_white]',
      )}
      style={{ left: x, top, width: w, height: h }}
      onPointerEnter={() => dispatch({ type: 'slideHovered', slideId: slide.id })}
      onPointerLeave={() => dispatch({ type: 'slideHovered', slideId: null })}
    >
      <div
        ref={boxRef}
        data-slide-box={slide.id}
        className={cn('relative size-full', !drawing && !isActive && 'cursor-pointer')}
        onClick={drawing ? undefined : activate}
      >
        <div
          className={cn(
            'absolute inset-0 overflow-hidden bg-placeholder transition-shadow',
            small ? 'rounded-thumb' : 'rounded-panel',
            !loaded && 'skeleton',
            !isActive && 'hover:shadow-[0_0_0_2px_rgb(255_255_255/0.3)]',
          )}
        >
          <img
            src={small ? slide.thumbnailUrl : slide.imageUrl}
            alt={slide.title ?? label}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={cn(
              'size-full object-contain transition-opacity duration-300 select-none',
              loaded ? 'opacity-100' : 'opacity-0',
              slide.hidden && 'opacity-40',
            )}
          />
          {isActive && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_black]"
            />
          )}
        </div>
        {((slide.hidden && w >= 200) || badge) && (
          // Top left (Figma D2). No z-index: pins and annotations (rendered after it) stay on top
          // and clickable – the status banners take their own room above the track.
          <div
            className={cn(
              'pointer-events-none absolute flex max-w-[calc(100%-16px)] items-center gap-1.5',
              small ? 'top-1.5 left-1.5' : 'top-3 left-3',
            )}
          >
            {slide.hidden && w >= 200 && (
              <Badge className="shrink-0 bg-black/60! backdrop-blur">
                <Icon name="visibilityOff" size={14} />
                Ausgeblendet
              </Badge>
            )}
            {badge && (
              <ChangeBadge
                badge={badge}
                version={badgeVersion}
                size={w < 160 ? 'mini' : 'track'}
                className="min-w-0"
              />
            )}
          </div>
        )}
        <AnnotationLayer slide={slide} threads={threads} emphasisId={emphasisId} draft={draft} />
        {drawing && <DrawingSurface slide={slide} boxRef={boxRef} tool={tool} color={color} />}
      </div>
    </div>
  );
});
