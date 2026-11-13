import {
  shapeOutlinePath,
  type ElementFlip,
  type ElementTilt,
  type Point,
  type Rect,
  type ShapeOutline,
} from '@slider/shared';
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/ui';
import { BRACKET_GRIPS, CORNERS } from './corners';
import { FrameEdges } from './RectFrame';
import { FrameOutline } from './FrameOutline';
import { TurnHandleHint } from './TurnHandleHint';
import { useFrameSize } from './hooks/useFrameSize';
import { useNearHandles } from './hooks/useNearHandles';
import { FRAME_ATTR, useRectEdit, type RectCorner } from './hooks/useRectEdit';
import type { SnapLines } from './lib/rect-edit';
import type { FrameHandle } from './lib/frame-outline';
import { frameHalo, HANDLE_CLASS, handleRing } from './lib/mark-chrome';
import { elementTransform } from '../editing/tilt/tilt-math';

interface EditableFrameProps {
  rect: Rect;
  color: string;
  /**
   * The new place after a move or resize – pulled over a side, how it is mirrored now (`flip`);
   * call `done` once it is stored.
   */
  onCommit: (rect: Rect, done: () => void, flip?: ElementFlip) => void;
  /** The box as shown while dragged, `null` once it is back to `rect` – its turn and mirroring. */
  onPreview?: (rect: Rect | null, rotation?: number, flip?: ElementFlip) => void;
  /** Moved and resized beyond the slide's edge too (a slide's element; a comment's mark stays on). */
  offSlide?: boolean;
  /** A resize of the unturned box, caught where it should be (a text's own size). */
  snapResize?: (rect: Rect, start: Rect, corner: RectCorner) => Rect;
  /** A double click on a corner fits the box to what it holds (a text's own size). */
  onFit?: (corner: RectCorner) => void;
  /** Lines it is caught at while moved or resized unturned (the guides, a layout grid). */
  snapLines?: SnapLines | null;
  /** Where a point on screen lies on the slide, when the slide is not seen flat (`useRectEdit`). */
  toSlide?: (x: number, y: number) => Point | null;
  /** Turned by this much (degrees clockwise, around its centre). */
  rotation?: number;
  /** A handle on its top edge turns it: the new turn; call `done` once it is stored. */
  onRotate?: (rotation: number, done: () => void) => void;
  /** Tilted in depth by this much. */
  tilt?: ElementTilt | null;
  /**
   * Its turning handle dragged with ⇧, it tilts in depth: the new tilt – over the edge, mirrored
   * so on screen (`mirror`); call `done` once it is stored.
   */
  onTilt?: (tilt: ElementTilt, done: () => void, mirror?: ElementFlip) => void;
  /** How it is mirrored – then it mirrors, pulled over a side or tilted over the edge. */
  flip?: ElementFlip | null;
  /** A slide element's own outline (a triangle): its line follows that, not the box. */
  outline?: ShapeOutline;
  /** The tilt as shown while dragged with ⇧, `null` once it is back to `tilt`. */
  onTiltPreview?: (tilt: ElementTilt | null) => void;
  /** No tilt here (`onTilt` unset): ⇧ over its turning handle turns the handle into this hint. */
  tiltHint?: string;
  /** The pointer came onto the turning handle: a turn – or with ⇧ a tilt – may follow. */
  onTurnHandleEnter?: () => void;
  /** A click (not a drag) on the box. */
  onActivate?: (event: MouseEvent) => void;
  /** A double click on the box. */
  onDoubleClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  /** Show the corner handles (always for the draft, on hover/focus for a sent box). */
  handles: boolean;
  /**
   * A slide element: the line centred on its edge, where LibreOffice draws an outline; the handles
   * sit on that line like on any box.
   */
  elementEdge?: boolean;
  emphasized?: boolean;
  /**
   * Its line and move cursor shown at rest; off, only while it is dragged (an element not picked
   * yet: the plain cursor until it is).
   */
  outlined?: boolean;
  /** A comment's mark: connector lines pass behind it. */
  isMark?: boolean;
  /** Only the border takes the pointer; what lies inside the box stays reachable. */
  edgesOnly?: boolean;
  title?: string;
  className?: string;
  /** The comment's badge, on the top-left corner: dragging it moves the box, no resizing there. */
  badge?: ReactNode;
  children?: ReactNode;
}

/**
 * A marked area that moves by dragging it and resizes by its corners – the draft's box and the
 * boxes of one's own comments. Like `RectFrame`, positioned in percent of the slide box.
 */
export function EditableFrame({
  rect,
  color,
  onCommit,
  onPreview,
  snapResize,
  onFit,
  snapLines,
  toSlide,
  offSlide = false,
  rotation = 0,
  onRotate,
  tilt,
  onTilt,
  onTiltPreview,
  flip,
  outline,
  tiltHint,
  onTurnHandleEnter,
  onActivate,
  onDoubleClick,
  onContextMenu,
  onPointerEnter,
  onPointerLeave,
  handles,
  elementEdge = false,
  emphasized = false,
  outlined = true,
  isMark = false,
  edgesOnly = false,
  title,
  className,
  badge,
  children,
}: EditableFrameProps) {
  const edit = useRectEdit(rect, onCommit, {
    onPreview,
    snapResize,
    snapLines,
    keepOnSlide: !offSlide,
    rotation,
    onRotate,
    tilt,
    onTilt,
    onTiltPreview,
    toSlide,
    flip,
  });
  const shown = edit.rect;
  const turn = edit.rotation;
  const lit = emphasized || edit.dragging;
  const line = outlined || edit.dragging;
  const showHandles = handles || edit.dragging;
  const frameRef = useRef<HTMLDivElement>(null);
  // The corner the last press began on (`null`: elsewhere) – for a double click on it (`onFit`).
  const pressedCorner = useRef<RectCorner | null>(null);
  const size = useFrameSize(frameRef, elementEdge);
  // ⇧ over the turning handle where it cannot tilt: the handle says why.
  const hinted = !!tiltHint && !onTilt;
  const [turnHandle, setTurnHandle] = useState<HTMLSpanElement | null>(null);
  const [overTurn, setOverTurn] = useState(false);
  const [shift, setShift] = useState(false);
  useEffect(() => {
    if (!hinted || !overTurn) return;
    const follow = (event: KeyboardEvent) => setShift(event.shiftKey);
    window.addEventListener('keydown', follow);
    window.addEventListener('keyup', follow);
    return () => {
      window.removeEventListener('keydown', follow);
      window.removeEventListener('keyup', follow);
    };
  }, [hinted, overTurn]);
  // A slide element's line is drawn as one stroke that runs out around its handles.
  // Its handles shown (picked, or under the pointer in box mode), it has its line too.
  const drawn = elementEdge && (line || showHandles) && size !== null;
  // Its brackets and dome open only as the pointer nears them; till then plain line.
  const grips = useRef<Partial<Record<FrameHandle, HTMLSpanElement | null>>>({});
  const side = size ? Math.round(Math.min(size.width, size.height) * size.scale) : 0;
  const near = useNearHandles(drawn && showHandles, side, grips);
  const turnGrip = useCallback((grip: HTMLSpanElement | null) => {
    grips.current.turn = grip;
    setTurnHandle(grip);
  }, []);

  return (
    <div
      ref={frameRef}
      {...{ [FRAME_ATTR]: '' }}
      data-mark={isMark ? 'frame' : undefined}
      // Moved by its border alone: its handles and border are controls over what lies inside.
      data-edges-only={edgesOnly ? '' : undefined}
      title={title}
      {...edit.boxProps}
      // The press caught by the frame (its click and double click come here then): whether it
      // began on a corner – set by the corner, after this.
      onPointerDownCapture={() => {
        pressedCorner.current = null;
      }}
      onClick={(event) => {
        event.stopPropagation();
        // A corner fitted by a double click: its clicks do not type in the box.
        if (!edit.wasDragged() && !(onFit && pressedCorner.current)) onActivate?.(event);
      }}
      onDoubleClick={
        (onDoubleClick || onFit) &&
        ((event) => {
          event.stopPropagation();
          const corner = pressedCorner.current;
          if (corner && onFit) onFit(corner);
          else onDoubleClick?.(event);
        })
      }
      onContextMenu={onContextMenu}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={cn(
        'absolute touch-none rounded-thumb',
        outlined ? 'cursor-move' : 'cursor-default',
        !elementEdge && 'border-2',
        edgesOnly ? 'pointer-events-none' : 'pointer-events-auto',
        lit && 'z-(--z-raised)',
        className,
      )}
      style={{
        left: `${shown.x * 100}%`,
        top: `${shown.y * 100}%`,
        width: `${shown.w * 100}%`,
        height: `${shown.h * 100}%`,
        // Turned and tilted as the element is (its tilt's perspective in the slide's widths).
        transform: elementTransform(turn, edit.tilt),
        ...(!line || drawn
          ? { borderColor: 'transparent' }
          : elementEdge
            ? { outline: `2px solid ${color}`, outlineOffset: -1 }
            : { borderColor: color }),
        boxShadow: lit && !drawn ? frameHalo(color) : undefined,
      }}
    >
      {edgesOnly && <FrameEdges />}
      {children}
      {edit.caught && (
        // Turned to a straight angle (or a step with ⌥), caught at a line: a thin pulse from its
        // whole frame, out and in – once per catch.
        <span
          key={edit.caught}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] snap-ring"
          style={{ ['--snap-color' as string]: color }}
        />
      )}
      {drawn && (
        <FrameOutline
          width={size.width}
          height={size.height}
          scale={size.scale}
          color={color}
          // The badge sits on the top left corner: no bracket under it.
          corners={
            showHandles
              ? CORNERS.map(({ corner }) => corner).filter((corner) => !(badge && corner === 'nw'))
              : []
          }
          near={near}
          dome={!!onRotate && showHandles}
          halo={lit}
          shape={
            outline &&
            shapeOutlinePath(outline, size.width * size.scale, size.height * size.scale, edit.flip)
          }
          // Drawn only for its handles (an element under the pointer): the box mode's look.
          hovered={!line}
        />
      )}
      {badge && (
        // Centred on the box's outer corner, where the badge sat on its own. No handle: a press
        // on it goes on to the box, so a drag moves the box and a click opens the thread.
        <span
          role="presentation"
          // The click that ends a drag is no click on the badge either: where it lands on the badge
          // (Safari, Firefox – Chrome gives it to the capturing frame) it must not open the thread.
          onClickCapture={(event) => {
            if (edit.wasDragged()) event.stopPropagation();
          }}
          className="pointer-events-auto absolute -top-3.5 -left-3.5 z-(--z-raised) size-6 cursor-pointer touch-none"
        >
          {badge}
        </span>
      )}
      {onRotate && showHandles && (
        // Centred on the top edge, like the corners – turned with the box.
        <span
          role="presentation"
          title={
            onTilt || hinted
              ? 'Drehen (⌥ in 15°-Schritten, ⇧ kippt in die Tiefe)'
              : 'Drehen (⌥ in 15°-Schritten)'
          }
          ref={turnGrip}
          {...edit.turnProps}
          onPointerEnter={(event) => {
            setOverTurn(true);
            setShift(event.shiftKey);
            onTurnHandleEnter?.();
          }}
          onPointerLeave={() => setOverTurn(false)}
          className={cn(
            'pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-grab touch-none rounded-full active:cursor-grabbing',
            // Drawn: only where to grab the dome the line runs around.
            drawn ? '-top-3.5 h-6 w-8' : '-top-1.5 size-3 bg-white',
          )}
          style={drawn ? undefined : { boxShadow: handleRing(color) }}
        />
      )}
      {hinted && tiltHint && (
        <TurnHandleHint
          anchor={turnHandle}
          open={overTurn && shift && !!onRotate && showHandles}
          text={tiltHint}
          color={color}
        />
      )}
      {showHandles &&
        CORNERS.filter(({ corner }) => !(badge && corner === 'nw')).map(
          ({ corner, className: position }) => (
            <span
              key={corner}
              ref={(grip) => {
                grips.current[corner] = grip;
              }}
              role="presentation"
              title={
                onFit
                  ? 'Größe ändern – ⇧ nur Breite, Höhe oder im Seitenverhältnis; Doppelklick passt an den Text an'
                  : 'Größe ändern – ⇧ nur Breite, Höhe oder im Seitenverhältnis'
              }
              {...edit.cornerProps(corner)}
              onPointerDown={(event) => {
                pressedCorner.current = corner;
                edit.cornerProps(corner).onPointerDown(event);
              }}
              className={cn(
                'pointer-events-auto',
                // Drawn: only where to grab the bracket the line runs around.
                drawn ? ['absolute touch-none', BRACKET_GRIPS[corner]] : [HANDLE_CLASS, position],
              )}
              style={drawn ? undefined : { boxShadow: handleRing(color) }}
            />
          ),
        )}
    </div>
  );
}
