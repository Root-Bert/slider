import {
  anchorBoxes,
  distance,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  shapeRefForRect,
  type AccentColor,
  type Anchor,
  type Point,
  type Rect,
  type Slide,
} from '@slider/shared';
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { accentColor } from '@/lib/accent';
import { isModKey } from '@/lib/keyboard';
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
import { useEditing } from '../editing/editing-context';
import { OffSlideLayer } from '../editing/OffSlideLayer';
import { LayerStage } from '../editing/layers/LayerStage';
import { useStagePhase } from '../editing/layers/useStagePhase';
import { SlideCompositor } from '../editing/compose/SlideCompositor';
import { PromptLayer } from '../editing/live/PromptLayer';
import { PhotoPreviewLayer } from '../editing/photos/PhotoPreviewLayer';
import { useViewerData } from '../state/viewer-data';
import { useSlideZoom } from '../state/viewer-store';
import { GuideEditor } from '../template/GuideEditor';
import { LayoutGridLayer } from '../template/LayoutGridLayer';
import { useLayoutGrid } from '../template/useLayoutGridLines';
import { usePlaceAiBox } from '../voice/hooks/usePlaceAiBox';
import { AnnotationLayer } from './AnnotationLayer';
import { useCentreFlash } from './hooks/useCentreFlash';
import { useSlideContextMenu } from './hooks/useSlideContextMenu';
import { shapeOfBox, slideBoxAt, useSlideBoxes, type SlideBox } from './hooks/useSlideBoxes';
import { boxAnchor, framedBoxesAnchor, toggleDraftBox } from './lib/box-anchor';
import { encloses, shownRect } from '../editing/lib/group-layout';
import { DrawingSurface } from './DrawingSurface';
import { FindOutline } from './FindOutline';
import { BoxHints } from './BoxHints';
import { GradientHandles } from './GradientHandles';
import { GuideLayer } from './GuideLayer';
import { TemplateLayer } from '../template/TemplateLayer';
import { useLayoutGuides } from '../template/useTemplate';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { SnapPulse } from './SnapPulse';
import { TextBoxEditor } from './TextBox';
import { slideSrcSet, THUMB_MAX_W } from './lib/slide-image';
import { SwapImage } from './SwapImage';
import { coverOf, isCropped, NO_COVER, startView, zoomedBox } from './lib/slide-zoom';

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
  /** „Layout-Ansicht“: the layout grid over it (not on thumbnails). */
  showLayoutGrid: boolean;
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
  showLayoutGrid,
  layered = false,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const zoom = useSlideZoom(slide.id);
  const dispatch = useViewerDispatch();
  const placeAiBox = usePlaceAiBox();
  // A template being designed keeps its guides itself, each layout its own.
  const template = useViewerData().deck.template ?? null;
  const layoutGuides = useLayoutGuides(slide.id);
  const layoutGrid = useLayoutGrid();
  // 'cached': the browser had the image already (scrolled back, remounted) – shown at once, no fade.
  const [loaded, setLoaded] = useState<false | 'fade' | 'cached'>(false);
  const label = slideLabel(index);
  const small = w < THUMB_MAX_W;
  // Taken apart: only the active slide (`Track`) – eased in and out of its layers, the tools
  // over it off meanwhile.
  const { phase, ready: stageReady } = useStagePhase(layered && !small);
  const stage = phase !== null;
  const src = small ? slide.thumbnailUrl : slide.imageUrl;
  const zoomed = zoom && !small ? zoom : null;
  // Filling a frame of another shape: cropped even unzoomed.
  const cover = coverOf(slide.aspectRatio, w / h);
  const cropped = isCropped(cover);
  const view = zoomed ?? (cropped ? startView(cover) : null);
  // Cropped, the chip goes back to the filled frame, not to the whole slide.
  const unzoomLabel =
    cropped || (zoomed && zoomed.scale < 1) ? 'Zoom zurücksetzen' : 'Ganze Folie zeigen';
  // Zoomed out: the whole slide shows, its corners rounded, room around it.
  const zoomedOut = !!zoomed && zoomed.scale < 1;
  // Moved there zoomed out, caught in the middle: its frame pulses in from the sides that way.
  // With the cover moving it reckons with (`coverIn`): none unless cropped.
  const centreCaught = useCentreFlash(zoomed, cropped ? cover : NO_COVER);
  // That room, in the slide's coordinates: what lies off the slide shows there.
  const around = (() => {
    if (!view || !zoomedOut) return null;
    const box = zoomedBox(view, w, h, cover);
    return {
      x: -box.left / box.width,
      y: -box.top / box.height,
      w: w / box.width,
      h: h / box.height,
    };
  })();
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
  // The slide's boxes – the same while editing (`useSlideBoxes`).
  const slideBoxes = useSlideBoxes(slide);
  const boxAt = (point: Point) => (boxes ? slideBoxAt(slide, slideBoxes, point) : null);
  // The box under the pointer: in box mode what a click comments on.
  const [hoveredShape, setHoveredShape] = useState<SlideBox | null>(null);
  const trackShapes = selecting && boxes;
  // While editing, the element under the pointer (`EditLayer`).
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);
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
    const shape = boxAt(probe);
    if (shape?.id !== hoveredShape?.id) setHoveredShape(shape);
  };
  // In box mode the boxes a frame being drawn encloses wholly, as they show (turned, tilted) – as a
  // frame picks elements while editing (`useInsertFrame`): the comment goes on them.
  const framed =
    dragRect && boxes
      ? slideBoxes.filter((box) => encloses(dragRect, shownRect(box, slide.aspectRatio)))
      : [];
  const onBoxPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag(null);
    if (!dragRect) return;
    skipClick.current = true;
    // Round boxes: one comment on all of them (with ⇧/⌘ added to the one being written).
    const anchor = framedBoxesAnchor(
      framed.map((box) => shapeOfBox(slide, box)),
      draft,
      slide.id,
      event.shiftKey || isModKey(event),
    );
    // Speaking to the AI: the area (the boxes round it) goes to the AI, not into a comment.
    const target = anchor ?? areaAnchor(dragRect, boxAt(rectCenter(dragRect)));
    if (placeAiBox) placeAiBox(slide.id, target);
    else startComment(target);
  };

  const activate = (event: MouseEvent) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (!boxRef.current) return;
    const point = toSlidePoint(event, boxRef.current);
    commentAt(point, boxAt(point), event.shiftKey || isModKey(event));
  };
  // A comment started on the slide – flat or taken apart (`LayerStage`), the same way: the slide
  // becomes the active one (no scrolling: it is in view, the comment goes where it was made).
  const startComment = (anchor: Anchor) => {
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    if (selecting) dispatch({ type: 'anchorPlaced', slideId: slide.id, anchor });
  };
  // A click: on the box `box` (box mode) it comments on the whole box, else where it was. With
  // ⇧/⌘ (`add`) the comment on boxes being written takes this box too – or lets it go again.
  const commentAt = (point: Point, box: SlideBox | null, add = false) => {
    const shape = box && shapeOfBox(slide, box);
    // Speaking to the AI: a box picked goes to it, as one drawn round it does.
    if (shape && !add && placeAiBox) {
      placeAiBox(slide.id, boxAnchor(shape));
      return;
    }
    const anchor = shape && add ? toggleDraftBox(draft, slide.id, shape) : null;
    startComment(anchor ?? (shape ? boxAnchor(shape) : { type: 'point', point, shapeRef: null }));
  };
  // An area dragged: in box mode bound to the box `box`, else free.
  const areaAnchor = (rect: Rect, box: SlideBox | null): Anchor => ({
    type: 'rect',
    rect,
    shapeRef: box ? shapeRefForRect(shapeOfBox(slide, box), rect) : null,
  });
  const shapeById = (id: string | null) => (id && slideBoxes.find((box) => box.id === id)) || null;
  // The boxes the comment being written is on – already outlined as its own.
  const draftShapeIds = new Set(
    !draft
      ? []
      : draft.anchor.type === 'point'
        ? [draft.anchor.shapeRef?.shapeId]
        : anchorBoxes(draft.anchor).map((box) => box.shapeRef?.shapeId),
  );
  // Outlined whole, also where it reaches beyond the slide (`useSlideBoxes`).
  // A frame round boxes outlines those instead (`framed`).
  const pointerTarget =
    trackShapes && hoveredShape && !draftShapeIds.has(hoveredShape.id) && framed.length === 0
      ? hoveredShape
      : null;
  const editing = useEditing();
  // „Hilfslinien setzen“: the template's guides set on the flat slide, over its elements.
  const settingGuides =
    editing.active && editing.tool === 'guides' && template !== null && !small && !stage;
  // C comments on the outlined box like a click would (`useStartComment`).
  const registry = useStageRegistry();
  const outlined = trackShapes ? hoveredShape : null;
  const slideMenu = useSlideContextMenu({ slide, boxRef, canComment: selecting, disabled: small });
  useEffect(() => {
    // The layer stage owns the pointer and its registry entry while taken apart.
    if (stage) return;
    registry.setHoveredBox(slide.id, outlined && shapeOfBox(slide, outlined));
    return () => registry.setHoveredBox(slide.id, null);
  }, [registry, slide, outlined, stage]);

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
            phase={phase}
            onReady={stageReady}
            src={src}
            w={w}
            h={h}
            color={accentColor(color)}
            boxes={boxMode}
            zoom={zoomed && zoomed.scale > 1 ? zoomed : null}
            // In box mode on the box of the layer it was made on: it shows on that plane.
            onComment={(point, box, add) => commentAt(point, shapeById(box), add)}
            onCommentArea={(rect, box) => {
              const anchor = areaAnchor(rect, shapeById(box));
              if (placeAiBox) placeAiBox(slide.id, anchor);
              else startComment(anchor);
            }}
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
                  boxes={boxMode}
                  still
                  slideBoxes={slideBoxes}
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
          // As wide as the slide: a tilted box's perspective is in its widths (`ShapeOutline`).
          style={{ containerType: 'inline-size', ...(view ? zoomedBox(view, w, h, cover) : {}) }}
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
          {/* The slide as it shows – its picture and what is drawn live over it: a hidden one
              dimmed as a whole, also while an edit is drawn live. */}
          <div className={cn('absolute inset-0', slide.hidden && 'opacity-40')}>
            <div
              className={cn(
                'absolute inset-0 overflow-hidden',
                // Only until the picture is there: at a fractional size it can fall a hair short of
                // the box, and the grey would show as a line along its bottom and right edge.
                (!loaded || failed) && 'bg-placeholder',
                // Taken apart in 3D: the stage below shows it – once its pictures are there, until
                // it is flat again.
                stage && phase !== 'prep' && phase !== 'closed' && 'invisible',
                // Cropped, the frame rounds the corners – the slide's own are out of view.
                (!view || zoomedOut) && (small ? 'rounded-thumb' : 'rounded-panel'),
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
                // A new picture (drawn anew after an edit) takes over without a blank frame.
                <SwapImage
                  // A new element asks again: the failed one is done for.
                  key={attempt}
                  src={src}
                  // The minimap's preview stands in while a remounted full image decodes.
                  initialSrc={small ? undefined : slide.thumbnailUrl}
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
                  onError={setFailedSrc}
                  className={cn(
                    'object-contain select-none',
                    loaded !== 'cached' && 'transition-opacity duration-300',
                    loaded ? 'opacity-100' : 'opacity-0',
                  )}
                />
              )}
            </div>
            {around && !small && !stage && <OffSlideLayer slideId={slide.id} frame={around} />}
            {!small && !stage && (
              // Bearbeiten composes the slide per element (docs/do-not-break.md).
              <SlideCompositor
                slideId={slide.id}
                rounded={view && !zoomedOut ? '' : 'rounded-panel'}
              />
            )}
            {!small && !stage && (
              <PromptLayer slideId={slide.id} rounded={view && !zoomedOut ? '' : 'rounded-panel'} />
            )}
            {!small && !stage && (
              <PhotoPreviewLayer
                slideId={slide.id}
                src={src}
                rounded={view && !zoomedOut ? '' : 'rounded-panel'}
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
          {w >= 120 && !stage && <LiveSlidePresence slideId={slide.id} small={small} />}
          {/* Next to the picture, not in a layer of their own: they take their contrast from it. */}
          {boxes && (selecting || editing.active) && (
            // The one under the pointer has its coloured outline instead.
            <BoxHints
              slideId={slide.id}
              boxes={slideBoxes}
              hoveredId={editing.active ? hoveredElement : outlined?.id}
            />
          )}
          {showLayoutGrid && !small && !stage && (
            <LayoutGridLayer grid={layoutGrid} color={accentColor(color)} />
          )}
          {showGuides && !small && !stage && !settingGuides && (
            <GuideLayer slide={slide} guides={layoutGuides?.guides} />
          )}
          {!small && !stage && (
            <EditLayer
              slideId={slide.id}
              color={accentColor(color)}
              boxes={boxes}
              onHover={setHoveredElement}
            />
          )}
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
              // Over the elements while editing, as in review: only the badges take a click.
              editing={editing.active}
              passive={editing.active && editing.selection?.slideId === slide.id}
              slideBoxes={slideBoxes}
            />
          )}
          {/* A template being designed: its placeholders marked, its guides to drag. */}
          {/* With the guides tool, GuideEditor draws (and drags) the guides alone. */}
          {!small && !stage && <TemplateLayer slideId={slide.id} guides={!settingGuides} />}
          {settingGuides && <GuideEditor slideId={slide.id} />}
          {!small && !stage && <GradientHandles slideId={slide.id} color={accentColor(color)} />}
          {dragRect && <RectFrame rect={dragRect} color={accentColor(color)} dashed />}
          {pointerTarget && (
            <ShapeOutline shape={pointerTarget} variant="target" color={accentColor(color)} />
          )}
          {framed.map((box) => (
            <ShapeOutline key={box.id} shape={box} variant="target" color={accentColor(color)} />
          ))}
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
        {zoomed && zoomed.scale !== 1 && (
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
      {/* Beside the frame, not in it: zoomed, it clips – the glow reaches out around it. */}
      {zoomedOut && centreCaught.x > 0 && (
        <SnapPulse key={`x${centreCaught.x}`} ways="x" color={accentColor(color)} />
      )}
      {zoomedOut && centreCaught.y > 0 && (
        <SnapPulse key={`y${centreCaught.y}`} ways="y" color={accentColor(color)} />
      )}
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
