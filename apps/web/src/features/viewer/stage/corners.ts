import type { RectCorner } from './hooks/useRectEdit';

/** The four resize handles, placed on a frame's corners. */
export const CORNERS: { corner: RectCorner; className: string }[] = [
  { corner: 'nw', className: '-top-1.5 -left-1.5 cursor-nwse-resize' },
  { corner: 'ne', className: '-top-1.5 -right-1.5 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
];

/** The handles just outside a frame's corners, so they never cover what lies inside it. */
export const OUTER_CORNERS: { corner: RectCorner; className: string }[] = [
  { corner: 'nw', className: '-top-3 -left-3 cursor-nwse-resize' },
  { corner: 'ne', className: '-top-3 -right-3 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-3 -left-3 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-3 -right-3 cursor-nwse-resize' },
];
