import type { EditableElement, Rect, SlideOperation } from '@slider/shared';
import { useEditing } from '../editing-context';
import type { GroupMoves } from '../lib/group-layout';
import { canMove, canSize } from '../live/model';

/** Where an element shows: a box growing with its text as high as it is drawn live. */
export function useShownBox() {
  const editing = useEditing();
  return (element: EditableElement): Rect => {
    const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
    return height === null ? element.bbox : { ...element.bbox, h: height };
  };
}

/** Elements moved, each by its own step – one edit (one step to take back). */
export function useMoveElements() {
  const editing = useEditing();
  return (elements: readonly EditableElement[], moves: GroupMoves) => {
    const operations: SlideOperation[] = [];
    for (const element of elements) {
      const move = moves.get(element.id);
      // Locked, it stays where it is.
      if (!move || !canMove(element)) continue;
      const { bbox } = element;
      operations.push({
        type: 'setBox',
        elementId: element.id,
        box: { ...bbox, x: bbox.x + move.dx, y: bbox.y + move.dy },
      });
    }
    return operations.length > 0 ? editing.apply(operations) : Promise.resolve(true);
  };
}

/** Elements given new boxes (of the slide, before they are turned) – one edit, one step back. */
export function useSetBoxes() {
  const editing = useEditing();
  return (elements: readonly EditableElement[], boxes: ReadonlyMap<string, Rect>) => {
    const operations: SlideOperation[] = [];
    for (const element of elements) {
      const box = boxes.get(element.id);
      // Locked, or one that only moves (a group of the file): its size stays.
      if (!box || !canSize(element)) continue;
      operations.push({ type: 'setBox', elementId: element.id, box });
    }
    return operations.length > 0 ? editing.apply(operations) : Promise.resolve(true);
  };
}
