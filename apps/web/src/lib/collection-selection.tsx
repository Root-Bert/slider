import { useRef, type MouseEvent, type RefObject } from 'react';
import { SelectionBox } from '@/ui/SelectionMarks';
import { useMarqueeSelect } from './marquee-select';
import { useMultiSelect } from './multi-select';

/** The attribute every selectable item of a collection carries, holding its id. */
export const SELECT_ID = 'data-select-id';

/** Clicks on these inside an item keep their own meaning, even with a modifier key. */
const ITEM_CONTROLS = 'button, input, [role="menu"]';

/**
 * Selection on a page of items – "Präsentationen", "Bibliothek" (templates and fonts) – one
 * behaviour everywhere: ⌘/Shift-click, ⌘A, Escape and a box dragged over empty space
 * (`useMultiSelect` + `useMarqueeSelect`). Put `onMouseDown` and `selectionStyle` on the
 * positioned page (`containerRef`), render `box` inside it and spread `itemProps(id)` on each item.
 */
export function useCollectionSelection(
  containerRef: RefObject<HTMLElement | null>,
  visibleIds: readonly string[],
) {
  const selection = useMultiSelect(visibleIds);
  const boxRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeSelect(containerRef, boxRef, {
    attribute: SELECT_ID,
    ...selection.marquee,
  });
  return {
    ...selection,
    onMouseDown: marquee.onMouseDown,
    box: marquee.active ? <SelectionBox ref={boxRef} /> : null,
  };
}

export interface SelectableItems {
  selected: ReadonlySet<string>;
  /** ⌘/Ctrl/Shift-click on an item, or any click while some are selected; true when it changed the selection. */
  onModifiedClick: (id: string, event: MouseEvent) => boolean;
  /** Right click on one of several selected: their shared actions instead of its own. */
  onSelectionMenu: (at: { x: number; y: number }) => void;
}

/**
 * Props for one item of a collection (its `<li>`): the id the selection box finds, a modified
 * click selecting instead of opening, a right click on the selection opening its menu.
 * `ownControls`: more places inside the item that keep their clicks.
 */
export function selectableItemProps(
  id: string,
  { selected, onModifiedClick, onSelectionMenu }: SelectableItems,
  ownControls?: string,
) {
  const controls = ownControls ? `${ownControls}, ${ITEM_CONTROLS}` : ITEM_CONTROLS;
  return {
    [SELECT_ID]: id,
    onClickCapture: (event: MouseEvent) => {
      if ((event.target as Element).closest(controls)) return;
      if (onModifiedClick(id, event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onContextMenuCapture: (event: MouseEvent) => {
      if (event.shiftKey || selected.size < 2 || !selected.has(id)) return;
      event.preventDefault();
      event.stopPropagation();
      onSelectionMenu({ x: event.clientX, y: event.clientY });
    },
  };
}
