import type { DiagramSide } from '@slider/shared';
import { createContext, useContext, type PointerEvent } from 'react';

/** What the boxes and arrows on the canvas need from the editor around them. */
export interface DiagramUi {
  canEdit: boolean;
  /** The box or arrow whose words are being typed. */
  editing: string | null;
  edit: (id: string | null) => void;
  /** Words typed into a box (or an arrow's label) are done. */
  commitText: (id: string, text: string) => void;
  /** A port of a box pressed: an arrow is drawn out of it. */
  startConnect: (id: string, side: DiagramSide, event: PointerEvent) => void;
  /** The frame a dragged box would land in. */
  dropFrame: string | null;
  /** The box an arrow being drawn would end at. */
  near: string | null;
  /** The one box picked alone: it shows its handles to size it. */
  single: string | null;
  /** Something is being dragged or drawn: the ports keep out of the way. */
  busy: boolean;
}

export const DiagramUiContext = createContext<DiagramUi | null>(null);

export function useDiagramUi(): DiagramUi {
  const ui = useContext(DiagramUiContext);
  if (!ui) throw new Error('useDiagramUi outside the diagram editor');
  return ui;
}

/** A box's colour as the CSS takes it: a tint by name, a colour of one's own as a variable. */
export function tintProps(color: string | undefined) {
  if (!color || color === 'gray') return {};
  if (color.startsWith('#')) {
    return { 'data-tint': 'custom', style: { '--dg-tint': color } as Record<string, string> };
  }
  return { 'data-tint': color };
}
