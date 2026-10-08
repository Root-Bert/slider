import { hitTestShapes, type AccentColor, type Slide } from '@slider/shared';
import { memo, useRef, useState, type PointerEvent } from 'react';
import { Badge, cn, Icon } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { toSlidePoint } from '../lib/geometry';
import { slideLabel } from '../lib/labels';
import type { SlideBadge } from '../lib/revision-changes';
import { ChangeBadge } from '../revisions/ChangeBadge';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerDispatch, type Draft, type Tool } from '../state/viewer-state';
import { AnnotationLayer } from './AnnotationLayer';
import { DrawingSurface } from './DrawingSurface';
import { TextBoxEditor } from './TextBox';

/** Below this width the slide shows its thumbnail image and small corners. */
const THUMB_MAX_W = 320;

/**
 * Raster slide images (Office/LibreOffice, BER-94) come as a 640 px thumbnail and a 2400 px image;
 * `srcset` lets the browser take whichever is sharp at this size and pixel density. SVG previews
 * (thumbnail = image) scale by themselves.
 */
const RASTER_WIDTHS = { thumbnail: 640, image: 2400 };
function slideSrcSet(slide: Slide, width: number) {
  if (slide.thumbnailUrl === slide.imageUrl) return {};
  return {
    srcSet: `${slide.thumbnailUrl} ${RASTER_WIDTHS.thumbnail}w, ${slide.imageUrl} ${RASTER_WIDTHS.image}w`,
    sizes: `${Math.max(1, Math.round(width))}px`,
  };
}

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
  /** "Boxen zeigen": outline the PowerPoint shapes (not on thumbnail-sized slides). */
  showShapes: boolean;
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
  showShapes,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const registry = useStageRegistry();
  const dispatch = useViewerDispatch();
  const [loaded, setLoaded] = useState(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  const drawing = isActive && tool !== null;
  const textBox = draft?.textBox ?? null;
  const shapesShown = showShapes && !small;
  // With all boxes shown, the one under the pointer gets its name (the mark tool shows its own).
  const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);
  const trackShapes = shapesShown && !(drawing && tool === 'mark');
  const onBoxPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!trackShapes || event.pointerType === 'touch' || !boxRef.current) return;
    const id = hitTestShapes(slide.shapes, toSlidePoint(event, boxRef.current))?.id ?? null;
    if (id !== hoveredShapeId) setHoveredShapeId(id);
  };

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
        onPointerMove={onBoxPointerMove}
        onPointerLeave={() => setHoveredShapeId(null)}
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
            {...slideSrcSet(slide, w)}
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
        <AnnotationLayer
          slide={slide}
          threads={threads}
          emphasisId={emphasisId}
          draft={draft}
          showShapes={shapesShown}
          hoveredShapeId={trackShapes ? hoveredShapeId : null}
        />
        {drawing && (
          <DrawingSurface
            slide={slide}
            boxRef={boxRef}
            tool={tool}
            color={color}
            hasText={(textBox?.text.trim().length ?? 0) > 0}
          />
        )}
        {textBox && <TextBoxEditor box={textBox} />}
      </div>
    </div>
  );
});
