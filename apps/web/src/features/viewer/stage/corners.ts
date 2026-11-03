import type { RectCorner } from './hooks/useRectEdit';

/** The four resize handles, placed on a frame's corners. */
export const CORNERS: { corner: RectCorner; className: string }[] = [
  { corner: 'nw', className: '-top-1.5 -left-1.5 cursor-nwse-resize' },
  { corner: 'ne', className: '-top-1.5 -right-1.5 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
];

/**
 * Where the drawn brackets are grabbed (`FrameOutline`): wider than the bracket and its stroke, so
 * the pointer on its way out to one never leaves the frame and its handles do not go.
 */
export const BRACKET_GRIPS: Record<RectCorner, string> = {
  nw: 'size-5 -top-2.5 -left-2.5 cursor-nwse-resize',
  ne: 'size-5 -top-2.5 -right-2.5 cursor-nesw-resize',
  sw: 'size-5 -bottom-2.5 -left-2.5 cursor-nesw-resize',
  se: 'size-5 -bottom-2.5 -right-2.5 cursor-nwse-resize',
};
