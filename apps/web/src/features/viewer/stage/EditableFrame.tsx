import type { Rect } from '@slider/shared';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/ui';
import { CORNERS, OUTER_CORNERS } from './corners';
import { FrameEdges } from './RectFrame';
import { FRAME_ATTR, useRectEdit } from './hooks/useRectEdit';
import { frameHalo, HANDLE_CLASS, handleRing } from './lib/mark-chrome';

interface EditableFrameProps {
  rect: Rect;
  color: string;
  /** The new place after a move or resize; call `done` once it is stored. */
  onCommit: (rect: Rect, done: () => void) => void;
  /** The box as shown while dragged, `null` once it is back to `rect`. */
  onPreview?: (rect: Rect | null) => void;
  /** A click (not a drag) on the box. */
  onActivate?: (event: MouseEvent) => void;
  /** A double click on the box. */
  onDoubleClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  /** Show the corner handles (always for the draft, on hover/focus for a sent box). */
  handles: boolean;
  /**
   * A slide element: the line centred on its edge, where LibreOffice draws an outline, and the
   * handles outside its corners – what it shows stays clear.
   */
  elementEdge?: boolean;
  emphasized?: boolean;
  /** A comment's mark: connector lines pass behind it. */
  isMark?: boolean;
  /** Only the border takes the pointer; what lies inside the box stays reachable. */
  edgesOnly?: boolean;
  title?: string;
  className?: string;
  /** The comment's badge, on the top-left corner: dragging it resizes from there. */
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
  onActivate,
  onDoubleClick,
  onContextMenu,
  handles,
  elementEdge = false,
  emphasized = false,
  isMark = false,
  edgesOnly = false,
  title,
  className,
  badge,
  children,
}: EditableFrameProps) {
  const edit = useRectEdit(rect, onCommit, { onPreview });
  const shown = edit.rect;
  const lit = emphasized || edit.dragging;

  return (
    <div
      {...{ [FRAME_ATTR]: '' }}
      data-mark={isMark ? 'frame' : undefined}
      title={title}
      {...edit.boxProps}
      onClick={(event) => {
        event.stopPropagation();
        if (!edit.wasDragged()) onActivate?.(event);
      }}
      onDoubleClick={
        onDoubleClick &&
        ((event) => {
          event.stopPropagation();
          onDoubleClick(event);
        })
      }
      onContextMenu={onContextMenu}
      className={cn(
        'absolute cursor-move touch-none rounded-thumb',
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
        ...(elementEdge
          ? { outline: `2px solid ${color}`, outlineOffset: -1 }
          : { borderColor: color }),
        boxShadow: lit ? frameHalo(color) : undefined,
      }}
    >
      {edgesOnly && <FrameEdges />}
      {children}
      {badge && (
        // Centred on the box's outer corner, where the badge sat on its own.
        <span
          role="presentation"
          title="Ziehen zum Ändern der Größe"
          {...edit.cornerProps('nw')}
          className="pointer-events-auto absolute -top-3.5 -left-3.5 z-(--z-raised) size-6 cursor-nwse-resize touch-none"
        >
          {badge}
        </span>
      )}
      {(handles || edit.dragging) &&
        (elementEdge ? OUTER_CORNERS : CORNERS)
          .filter(({ corner }) => !(badge && corner === 'nw'))
          .map(({ corner, className: position }) => (
            <span
              key={corner}
              role="presentation"
              title="Größe ändern"
              {...edit.cornerProps(corner)}
              className={cn('pointer-events-auto', HANDLE_CLASS, position)}
              style={{ boxShadow: handleRing(color) }}
            />
          ))}
    </div>
  );
}
