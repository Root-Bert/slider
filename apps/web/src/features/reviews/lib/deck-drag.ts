import type { DragEvent } from 'react';

/** Decks dragged onto a folder tile carry their ids under this type. */
const DECK_IDS_TYPE = 'application/x-slider-deck-ids';

export function setDraggedDecks(event: DragEvent, deckIds: readonly string[]) {
  event.dataTransfer.setData(DECK_IDS_TYPE, JSON.stringify(deckIds));
  event.dataTransfer.effectAllowed = 'move';
}

/** While dragging only the type is readable, not the ids. */
export const isDeckDrag = (event: DragEvent) => event.dataTransfer.types.includes(DECK_IDS_TYPE);

export function draggedDecks(event: DragEvent): string[] {
  try {
    const parsed: unknown = JSON.parse(event.dataTransfer.getData(DECK_IDS_TYPE) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
