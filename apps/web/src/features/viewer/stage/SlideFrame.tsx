import {
  distance,
  hitTestShapes,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  rectShapeRefAt,
  shapeRefForRect,
  type AccentColor,
  type Point,
  type Shape,
  type Slide,
  type SlideVersionView,
} from '@slider/shared';
import { memo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { accentColor } from '@/lib/accent';
import { Badge, cn, Icon } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { toSlidePoint } from '../lib/geometry';
import { slideLabel } from '../lib/labels';
import type { SlideBadge } from '../lib/revision-changes';
import { LiveSlidePresence } from '../live/LiveSlidePresence';
import { ChangeBadge } from '../revisions/ChangeBadge';
import { useViewerDispatch, type Draft, type Tool } from '../state/viewer-state';
import { AnnotationLayer } from './AnnotationLayer';
import { DrawingSurface } from './DrawingSurface';
import { GuideLayer } from './GuideLayer';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
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
  /** Only for the slide counter and screen readers – tools work on every slide. */
  isActive: boolean;
  /** Threads of this slide that pass the filter. */
  threads: Thread[];
  /** Focused or hovered thread – only set when it belongs to this slide. */
  emphasisId: string | null;
  /** The draft – only set when it is on this slide. */
  draft: Draft | null;
  /** Picked tool, `null` when not drawing or not allowed to comment. */
  tool: Tool | null;
  /** Pointer mode (no tool picked, may comment): a click on the slide starts a comment. */
  canSelect: boolean;
  color: AccentColor;
  /** Change of the latest revision – only set while changes are shown (Figma D2). */
  badge: SlideBadge | null;
  /** The revision the badge belongs to ("Geändert · V4"). */
  badgeVersion: number;
  /** Box mode as it applies now: comments attach to the PowerPoint box under the pointer. */
  boxMode: boolean;
  /** "Hilfslinien zeigen": PowerPoint's guides and the boxes crossing them (not on thumbnails). */
  showGuides: boolean;
  /**
   * "Alt" on a comment (BER-109): the version of this slide the comment was written on, shown
   * instead of the current one – read-only. `'loading'` while it is fetched, `null` = now.
   */
  previousVersion?: SlideVersionView | 'loading' | null;
}

/**
 * One slide in the timeline track: image, annotation overlay and – while a tool is selected – the
 * drawing surface, on every slide alike. With the pointer (the default tool) a click starts a
 * comment there: in box mode on the PowerPoint box under the pointer (outlined while hovered),
 * otherwise on the clicked spot. Which slide is "active" only matters to the slide counter.
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
  canSelect,
  color,
  badge,
  badgeVersion,
  boxMode,
  showGuides,
  previousVersion = null,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dispatch = useViewerDispatch();
  const [loaded, setLoaded] = useState(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  const old = previousVersion !== null && previousVersion !== 'loading' ? previousVersion : null;
  const showingOld = previousVersion !== null;
  // The old version: its image and boxes, so comments bound to a box sit where they sat then.
  const shown = old
    ? { ...slide, imageUrl: old.imageUrl, thumbnailUrl: old.thumbnailUrl, shapes: old.shapes }
    : slide;
  // Every slide takes the picked tool – not only the active one. Not an old version: what is
  // drawn or placed there would land on the current slide.
  const drawing = tool !== null && !showingOld;
  const textBox = draft?.textBox ?? null;
  const boxes = boxMode && !small;
  const selecting = canSelect && !drawing && !small && !showingOld;
  // The box under the pointer: in box mode what a click comments on.
  const [hoveredShape, setHoveredShape] = useState<Shape | null>(null);
  const trackShapes = selecting && boxes;
  // Pointer drag: a dragged area becomes the comment's frame (mouse and pen – touch scrolls).
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const dragged = drag !== null && distance(drag.start, drag.end) >= MIN_DRAG_DISTANCE;
  const dragRect = drag && dragged ? rectFromPoints(drag.start, drag.end) : null;
  // The click that ends a drag must not also place a pin.
  const skipClick = useRef(false);

  const onBoxPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!selecting || event.button !== 0 || event.pointerType === 'touch' || !boxRef.current) {
      return;
    }
    // Pins, badges and text boxes keep their own clicks.
    if ((event.target as Element).closest('button, textarea, input, [contenteditable]')) return;
    const point = toSlidePoint(event, boxRef.current);
    setDrag({ start: point, end: point });
  };
  const onBoxPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !boxRef.current) return;
    const point = toSlidePoint(event, boxRef.current);
    if (drag) {
      setDrag({ ...drag, end: point });
      // Captured only once it is a real drag, so a plain click still reaches what it hits.
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
    if (!trackShapes) return;
    // While dragging, the box under the area's centre is the one it would attach to.
    const probe = drag ? rectCenter(rectFromPoints(drag.start, point)) : point;
    const shape = hitTestShapes(slide.shapes, probe);
    if (shape?.id !== hoveredShape?.id) setHoveredShape(shape);
  };
  const onBoxPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (!dragRect) return;
    skipClick.current = true;
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    dispatch({
      type: 'anchorPlaced',
      slideId: slide.id,
      anchor: {
        type: 'rect',
        rect: dragRect,
        shapeRef: boxes ? rectShapeRefAt(slide.shapes, dragRect) : null,
      },
    });
  };

  const activate = (event: MouseEvent) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    // No scrolling: the slide is in view already, and the comment goes where the click was.
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    if (!selecting || !boxRef.current) return;
    const point = toSlidePoint(event, boxRef.current);
    const shape = boxes ? hitTestShapes(slide.shapes, point) : null;
    dispatch({
      type: 'anchorPlaced',
      slideId: slide.id,
      anchor: shape
        ? {
            type: 'rect',
            rect: shape.bbox,
            shapeRef: shapeRefForRect(shape, shape.bbox),
          }
        : // Outside box mode (or beside every box) the comment sits where the click was.
          { type: 'point', point, shapeRef: null },
    });
  };
  const draftShapeId =
    draft?.anchor.type === 'rect' || draft?.anchor.type === 'point'
      ? (draft.anchor.shapeRef?.shapeId ?? null)
      : null;
  const pointerTarget = trackShapes && hoveredShape?.id !== draftShapeId ? hoveredShape : null;

  return (
    <div
      data-slide-id={slide.id}
      role="group"
      aria-roledescription="Folie"
      aria-label={`${label} von ${total}${slide.title ? `: ${slide.title}` : ''}`}
      aria-current={isActive || undefined}
      className={cn('absolute snap-start', small ? 'rounded-thumb' : 'rounded-panel')}
      style={{ left: x, top, width: w, height: h }}
      onPointerEnter={() => dispatch({ type: 'slideHovered', slideId: slide.id })}
      onPointerLeave={() => dispatch({ type: 'slideHovered', slideId: null })}
    >
      <div
        ref={boxRef}
        data-slide-box={slide.id}
        className={cn(
          'relative size-full',
          !drawing && pointerTarget && 'cursor-pointer',
          selecting && !boxes && 'cursor-crosshair',
        )}
        onClick={drawing ? undefined : activate}
        onPointerDown={onBoxPointerDown}
        onPointerMove={onBoxPointerMove}
        onPointerUp={onBoxPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHoveredShape(null)}
      >
        <div
          className={cn(
            'absolute inset-0 overflow-hidden bg-placeholder',
            small ? 'rounded-thumb' : 'rounded-panel',
            !loaded && 'skeleton',
          )}
        >
          <img
            src={small ? shown.thumbnailUrl : shown.imageUrl}
            {...slideSrcSet(shown, w)}
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
        </div>
        {showingOld && (
          <OldVersionFrame
            version={old}
            small={small}
            onClose={() => dispatch({ type: 'previousViewSet', view: null })}
          />
        )}
        {!showingOld && ((slide.hidden && w >= 200) || badge) && (
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
        {w >= 120 && <LiveSlidePresence slideId={slide.id} small={small} />}
        {showGuides && !small && !showingOld && <GuideLayer slide={slide} />}
        <AnnotationLayer
          slide={shown}
          threads={threads}
          emphasisId={emphasisId}
          draft={draft}
          boxes={boxes}
          selecting={selecting}
          // The eraser wipes over drawings, so it stays on top of them.
          aboveTools={drawing && tool !== 'eraser'}
        />
        {dragRect && <RectFrame rect={dragRect} color={accentColor(color)} dashed />}
        {pointerTarget && (
          <ShapeOutline
            shape={pointerTarget}
            variant="target"
            color={accentColor(color)}
            labelled
          />
        )}
        {drawing && (
          <DrawingSurface
            slide={slide}
            boxRef={boxRef}
            tool={tool}
            color={color}
            threads={threads}
          />
        )}
        {textBox && <TextBoxEditor box={textBox} />}
      </div>
    </div>
  );
});

/**
 * Marks a slide shown as it was when a comment was written ("Alt", BER-109): an amber frame and
 * "Alt · V3" top left – a click on it, like "Neu" on the comment, shows the slide as it is now.
 */
function OldVersionFrame({
  version,
  small,
  onClose,
}: {
  /** `null` while it loads. */
  version: SlideVersionView | null;
  small: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px_var(--color-warning)]',
          small ? 'rounded-thumb' : 'rounded-panel',
        )}
      />
      <button
        type="button"
        data-old-version
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        title="Wieder die aktuelle Folie zeigen"
        className={cn(
          'absolute z-10 inline-flex items-center gap-1 rounded-badge bg-black/75 font-medium text-warning backdrop-blur',
          'shadow-[inset_0_0_0_1px_rgb(245_166_35/0.45)] hover:bg-black/90',
          small ? 'top-1.5 left-1.5 h-5 px-1.5 text-[10px]' : 'top-3 left-3 h-6 px-2.5 text-xs',
        )}
      >
        <Icon name="history" size={small ? 12 : 14} className="shrink-0" />
        {version ? `Alt · V${version.revisionNumber}` : 'Alt …'}
        {!small && <span className="text-fg-muted">{version ? '– so beim Kommentar' : ''}</span>}
        <Icon name="close" size={small ? 12 : 14} className="shrink-0 text-fg-muted" />
      </button>
    </>
  );
}
