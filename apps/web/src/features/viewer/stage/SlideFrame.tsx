import {
  distance,
  hitTestShapes,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  shapeRefForRect,
  type AccentColor,
  type Anchor,
  type Point,
  type Rect,
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
import { draftHasContent } from '../state/draft-reducer';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerDispatch, type Draft, type Tool } from '../state/viewer-state';
import { EditLayer } from '../editing/EditLayer';
import { LayerStage } from '../editing/layers/LayerStage';
import { LiveLayer } from '../editing/live/LiveLayer';
import { PhotoPreviewLayer } from '../editing/photos/PhotoPreviewLayer';
import { AnnotationLayer } from './AnnotationLayer';
import { useSlideContextMenu } from './hooks/useSlideContextMenu';
import { boxAnchor } from './lib/box-anchor';
import { DrawingSurface } from './DrawingSurface';
import { FindOutline } from './FindOutline';
import { GuideLayer } from './GuideLayer';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { TextBoxEditor } from './TextBox';
import { slideSrcSet, THUMB_MAX_W } from './lib/slide-image';
import { coverOf, isCropped, startView, zoomedBox, type SlideZoom } from './lib/slide-zoom';

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
  /** Done threads' marks step back – not while only done ones are shown. */
  fadeDone: boolean;
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
  /** Zoom inside this slide (pinch past the largest slides) – only set when it is this slide's. */
  zoom: SlideZoom | null;
  /** „Ebenen“ is on: the slide shows taken apart in 3D instead of its picture. */
  layered?: boolean;
}

/**
 * One slide in the timeline track: image, annotation overlay and – while a tool is selected – the
 * drawing surface, on every slide alike. With the pointer (the default tool) a click starts a
 * comment there: in box mode on the PowerPoint box under the pointer (outlined while hovered),
 * otherwise on the clicked spot. Which slide is "active" only matters to the slide counter.
 * Zoomed, the slide box (and everything on it) is laid out that much bigger inside its frame,
 * which crops it – pins and lines keep their size, and the sharper image loads by itself. A frame
 * of another shape than the slide (portrait pages in the 16:9 view) is filled by the slide and
 * crops it the same way, from its top until the wheel moves it.
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
  fadeDone,
  tool,
  canSelect,
  color,
  badge,
  badgeVersion,
  boxMode,
  showGuides,
  zoom,
  layered = false,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dispatch = useViewerDispatch();
  // 'cached': the browser had the image already (scrolled back, remounted) – shown at once, no fade.
  const [loaded, setLoaded] = useState<false | 'fade' | 'cached'>(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  const stage = layered && !small;
  const src = small ? slide.thumbnailUrl : slide.imageUrl;
  const zoomed = zoom && !small ? zoom : null;
  // Filling a frame of another shape: cropped even unzoomed.
  const cover = coverOf(slide.aspectRatio, w / h);
  const cropped = isCropped(cover);
  const view = zoomed ?? (cropped ? startView(cover) : null);
  // Cropped, the chip goes back to the filled frame, not to the whole slide.
  const unzoomLabel = cropped ? 'Zoom zurücksetzen' : 'Ganze Folie zeigen';
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
  const boxes = boxMode && !small && !stage;
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
    commentOn(dragRect, boxes ? hitTestShapes(slide.shapes, rectCenter(dragRect)) : null);
  };

  const activate = (event: MouseEvent) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (!boxRef.current) return;
    const point = toSlidePoint(event, boxRef.current);
    commentAt(point, boxes ? hitTestShapes(slide.shapes, point) : null);
  };
  // A comment started on the slide – flat or taken apart (`LayerStage`), the same way: the slide
  // becomes the active one (no scrolling: it is in view, the comment goes where it was made).
  const startComment = (anchor: Anchor) => {
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    if (selecting) dispatch({ type: 'anchorPlaced', slideId: slide.id, anchor });
  };
  // A click: on the box `shape` (box mode) it comments on the whole box, else where it was.
  const commentAt = (point: Point, shape: Shape | null) =>
    startComment(shape ? boxAnchor(shape) : { type: 'point', point, shapeRef: null });
  // An area dragged: in box mode bound to the box `shape`, else free.
  const commentOn = (rect: Rect, shape: Shape | null) =>
    startComment({ type: 'rect', rect, shapeRef: shape ? shapeRefForRect(shape, rect) : null });
  const shapeById = (id: string | null) =>
    (id && slide.shapes.find((shape) => shape.id === id)) || null;
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
        data-slide-frame={slide.id}
        className={cn(
          'relative size-full',
          view && 'overflow-hidden',
          view && (small ? 'rounded-thumb' : 'rounded-panel'),
        )}
        // The wheel moves the part a cropped slide shows (`useTimelineWheel`).
        data-slide-cover={cropped && !small ? `${cover.x},${cover.y}` : undefined}
      >
        {/* Taken apart, the slide floats in its frame, from the front too: the tools over it are
            off, the stage takes the pointer – comments on its planes, a double click to edit. */}
        {stage && (
          <LayerStage
            slideId={slide.id}
            active={isActive}
            src={src}
            w={w}
            h={h}
            color={accentColor(color)}
            boxes={boxMode}
            // In box mode on the box of the layer it was made on: it shows on that plane.
            onComment={(point, box) => commentAt(point, shapeById(box))}
            onCommentArea={(rect, box) => commentOn(rect, shapeById(box))}
            // The comment its two clicks started goes – one already written stays.
            onEdit={() => {
              if (draft && !draftHasContent(draft)) dispatch({ type: 'draftCancelled' });
            }}
            marks={{
              threads,
              shapes: slide.shapes,
              draft: draft?.anchor ?? null,
              render: (onPlane, withDraft) => (
                <AnnotationLayer
                  slide={slide}
                  threads={onPlane}
                  emphasisId={emphasisId}
                  draft={withDraft ? draft : null}
                  fadeDone={fadeDone}
                  still
                />
              ),
            }}
          />
        )}
        <div
          ref={boxRef}
          data-slide-box={slide.id}
          className={cn(
            view ? 'absolute' : 'relative size-full',
            // The stage under it takes the pointer: only pins and the like keep theirs.
            stage && 'pointer-events-none',
            !drawing && pointerTarget && 'cursor-pointer',
            selecting && !boxes && 'cursor-crosshair',
          )}
          style={view ? zoomedBox(view, w, h, cover) : undefined}
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
              // Taken apart in 3D: the stage below shows it.
              stage && 'invisible',
              // Cropped, the frame rounds the corners – the slide's own are out of view.
              !view && (small ? 'rounded-thumb' : 'rounded-panel'),
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
                {...slideSrcSet(slide, view ? zoomedBox(view, w, h, cover).width : w)}
                alt={slide.title ?? label}
                // No `loading="lazy"`: the timeline only mounts slides near the viewport, and lazy
                // would wait until one scrolls in.
                ref={(img) => {
                  if (img?.complete && img.naturalWidth > 0) setLoaded((l) => l || 'cached');
                }}
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded((l) => l || 'fade')}
                onError={() => setFailedSrc(src)}
                className={cn(
                  'size-full object-contain select-none',
                  loaded !== 'cached' && 'transition-opacity duration-300',
                  loaded ? 'opacity-100' : 'opacity-0',
                  slide.hidden && 'opacity-40',
                )}
              />
            )}
          </div>
          {!small && !stage && (
            <LiveLayer slideId={slide.id} src={src} rounded={view ? '' : 'rounded-panel'} />
          )}
          {!small && !stage && (
            <PhotoPreviewLayer slideId={slide.id} src={src} rounded={view ? '' : 'rounded-panel'} />
          )}
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
          {w >= 120 && !stage && <LiveSlidePresence slideId={slide.id} small={small} />}
          {showGuides && !small && !stage && <GuideLayer slide={slide} />}
          {!stage && (
            <AnnotationLayer
              slide={slide}
              threads={threads}
              emphasisId={emphasisId}
              draft={draft}
              fadeDone={fadeDone}
              boxes={boxes}
              selecting={selecting}
              // The eraser wipes over drawings, so it stays on top of them.
              aboveTools={drawing && tool !== 'eraser'}
            />
          )}
          {!small && !stage && <EditLayer slideId={slide.id} color={accentColor(color)} />}
          {dragRect && <RectFrame rect={dragRect} color={accentColor(color)} dashed />}
          {pointerTarget && (
            <ShapeOutline
              shape={pointerTarget}
              variant="target"
              color={accentColor(color)}
              padded
            />
          )}
          {!small && <FindOutline slideId={slide.id} />}
          {drawing && !stage && (
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
        {zoomed && zoomed.scale > 1 && (
          <Button
            variant="secondary"
            size="xs"
            trailingIcon="close"
            className="absolute top-3 right-3 tabular-nums"
            aria-label={`Zoom ${Math.round(zoomed.scale * 100)} % – ${unzoomLabel}`}
            title={unzoomLabel}
            onClick={() => dispatch({ type: 'slideZoomChanged', slideId: slide.id, zoom: null })}
          >
            {Math.round(zoomed.scale * 100)} %
          </Button>
        )}
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
