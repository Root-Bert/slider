import type { Rect } from '@slider/shared';
import type { ReactNode } from 'react';
import { cn } from '@/ui';
import { FRAME_ATTR, useRectEdit, type RectCorner } from '../hooks/useRectEdit';

const CORNERS: { corner: RectCorner; className: string }[] = [
  { corner: 'nw', className: '-top-1.5 -left-1.5 cursor-nwse-resize' },
  { corner: 'ne', className: '-top-1.5 -right-1.5 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
];

interface EditableFrameProps {
  rect: Rect;
  color: string;
  /** The new place after a move or resize; call `done` once it is stored. */
  onCommit: (rect: Rect, done: () => void) => void;
  /** A click (not a drag) on the box. */
  onActivate?: () => void;
  /** Show the corner handles (always for the draft, on hover/focus for a sent box). */
  handles: boolean;
  emphasized?: boolean;
  /** A comment's mark: connector lines pass behind it. */
  isMark?: boolean;
  title?: string;
  className?: string;
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
  onActivate,
  handles,
  emphasized = false,
  isMark = false,
  title,
  className,
  children,
}: EditableFrameProps) {
  const edit = useRectEdit(rect, onCommit);
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
        if (!edit.wasDragged()) onActivate?.();
      }}
      className={cn(
        'pointer-events-auto absolute cursor-move touch-none rounded-thumb border-2',
        lit && 'z-10',
        className,
      )}
      style={{
        left: `${shown.x * 100}%`,
        top: `${shown.y * 100}%`,
        width: `${shown.w * 100}%`,
        height: `${shown.h * 100}%`,
        borderColor: color,
        boxShadow: lit ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)` : undefined,
      }}
    >
      {children}
      {(handles || edit.dragging) &&
        CORNERS.map(({ corner, className: position }) => (
          <span
            key={corner}
            role="presentation"
            title="Größe ändern"
            {...edit.cornerProps(corner)}
            className={cn('absolute size-3 touch-none rounded-[3px] bg-white', position)}
            style={{ boxShadow: `0 0 0 1.5px ${color}` }}
          />
        ))}
    </div>
  );
}
