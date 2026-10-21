import {
  distance,
  hitTestShapes,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  rectShapeRefAt,
  type AccentColor,
  type Point,
  type Shape,
  type Slide,
} from '@slider/shared';
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { accentColor } from '@/lib/accent';
import { Badge, Button, cn, Icon } from '@/ui';
import type { Thread } from '../comments/lib/comment-selectors';
import { toSlidePoint } from '../lib/geometry';
import { slideLabel } from '../comments/lib/labels';
import { visibilityChange, type SlideBadge } from '../revisions/lib/revision-changes';
import { LiveSlidePresence } from '../live/LiveSlidePresence';
import { ChangeBadge } from '../revisions/ChangeBadge';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerDispatch, type Draft, type Tool } from '../state/viewer-state';
import { AnnotationLayer } from './AnnotationLayer';
import { useSlideContextMenu } from './hooks/useSlideContextMenu';
import { boxAnchor } from './lib/box-anchor';
import { DrawingSurface } from './DrawingSurface';
import { GuideLayer } from './GuideLayer';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { TextBoxEditor } from './TextBox';
import { slideSrcSet, THUMB_MAX_W } from './lib/slide-image';

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
  /** The revision the badge belongs to ("Geändert | V4"). */
  badgeVersion: number;
  /** Box mode as it applies now: comments attach to the PowerPoint box under the pointer. */
  boxMode: boolean;
  /** "Hilfslinien zeigen": PowerPoint's guides and the boxes crossing them (not on thumbnails). */
  showGuides: boolean;
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
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dispatch = useViewerDispatch();
  const [loaded, setLoaded] = useState(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  const src = small ? slide.thumbnailUrl : slide.imageUrl;
  // The image that failed (404, network): a quiet note instead of a placeholder pulsing forever.
  // Keyed by its URL – another size or a new version tries again on its own.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failed = failedSrc === src;
  // Hidden / shown again in this revision: its own chip, next to the content badge.
  const visibility = w >= 200 ? visibilityChange(slide.change) : null;
  // Every slide takes the picked tool – not only the active one.
  const drawing = tool !== null;
  const textBox = draft?.textBox ?? null;
  const boxes = boxMode && !small;
  const selecting = canSelect && !drawing && !small;
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
    // A drag whose click never came (released elsewhere) must not swallow this one.
    skipClick.current = false;
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
        ? boxAnchor(shape)
        : // Outside box mode (or beside every box) the comment sits where the click was.
          { type: 'point', point, shapeRef: null },
    });
  };
  const draftShapeId =
    draft?.anchor.type === 'rect' || draft?.anchor.type === 'point'
      ? (draft.anchor.shapeRef?.shapeId ?? null)
      : null;
  const pointerTarget = trackShapes && hoveredShape?.id !== draftShapeId ? hoveredShape : null;
  // C comments on the outlined box like a click would (`useStartComment`).
  const registry = useStageRegistry();
  const outlined = trackShapes ? hoveredShape : null;
  const slideMenu = useSlideContextMenu({ slide, boxRef, canComment: selecting, disabled: small });
  useEffect(() => {
    registry.setHoveredBox(slide.id, outlined);
    return () => registry.setHoveredBox(slide.id, null);
  }, [registry, slide.id, outlined]);

  return (
    <div
      data-slide-id={slide.id}
      role="group"
      aria-roledescription="Folie"
      aria-label={`${label} von ${total}${slide.title ? `: ${slide.title}` : ''}`}
      aria-current={isActive || undefined}
      className={cn('absolute snap-start', small ? 'rounded-thumb' : 'rounded-panel')}
      style={{ left: x, top, width: w, height: h }}
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
        onPointerLeave={(event) => {
          setHoveredShape(null);
          // Left before the drag captured the pointer: its release never comes here.
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) setDrag(null);
        }}
        onContextMenu={drawing ? undefined : slideMenu.onContextMenu}
      >
        <div
          className={cn(
            'absolute inset-0 overflow-hidden bg-placeholder',
            small ? 'rounded-thumb' : 'rounded-panel',
            !loaded && !failed && 'skeleton',
          )}
        >
          {failed ? (
            <SlideImageError
              small={small}
              onRetry={() => {
                setFailedSrc(null);
                setAttempt((n) => n + 1);
              }}
            />
          ) : (
            <img
              // A new element asks again: the failed one is done for.
              key={attempt}
              src={src}
              {...slideSrcSet(slide, w)}
              alt={slide.title ?? label}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailedSrc(src)}
              className={cn(
                'size-full object-contain transition-opacity duration-300 select-none',
                loaded ? 'opacity-100' : 'opacity-0',
                slide.hidden && 'opacity-40',
              )}
            />
          )}
        </div>
        {((slide.hidden && w >= 200) || visibility || badge) && (
          // Top left (Figma D2). No z-index: pins and annotations (rendered after it) stay on top
          // and clickable – the status banners take their own room above the track.
          <div
            className={cn(
              'pointer-events-none absolute flex max-w-[calc(100%-16px)] items-center gap-1.5',
              small ? 'top-1.5 left-1.5' : 'top-3 left-3',
            )}
          >
            {slide.hidden && w >= 200 && (
              <Badge
                tone="overlay"
                className="shrink-0"
                title={visibility?.kind === 'hidden' ? visibility.description : undefined}
                data-visibility-change={visibility?.kind === 'hidden' ? 'hidden' : undefined}
              >
                <Icon name="visibilityOff" size="sm" />
                Ausgeblendet
                {visibility?.kind === 'hidden' && (
                  <span className="sr-only">: {visibility.description}</span>
                )}
              </Badge>
            )}
            {visibility?.kind === 'shown' && !slide.hidden && (
              <Badge
                tone="overlay"
                className="shrink-0"
                title={visibility.description}
                data-visibility-change="shown"
              >
                <Icon name="visibility" size="sm" />
                {visibility.label}
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
        {showGuides && !small && <GuideLayer slide={slide} />}
        <AnnotationLayer
          slide={slide}
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
          <ShapeOutline shape={pointerTarget} variant="target" color={accentColor(color)} />
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
      {slideMenu.contextMenu}
    </div>
  );
});

const IMAGE_ERROR = 'Folie konnte nicht geladen werden';

/** Stand-in for a slide image that didn't load; thumbnails only show the icon. */
function SlideImageError({ small, onRetry }: { small: boolean; onRetry: () => void }) {
  return (
    <div
      data-slide-image-error
      className="flex size-full flex-col items-center justify-center gap-2 px-2 text-center text-fg-subtle"
    >
      <Icon name="image" size={small ? 'sm' : 'xl'} className="shrink-0" />
      {small ? (
        <span className="sr-only">{IMAGE_ERROR}</span>
      ) : (
        <>
          <span className="text-xs">{IMAGE_ERROR}</span>
          <Button
            variant="secondary"
            size="xs"
            icon="refresh"
            // The slide behind places comments on click.
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
          >
            Erneut laden
          </Button>
        </>
      )}
    </div>
  );
}
