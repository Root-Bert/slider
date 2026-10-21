import type { DragEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { draggedDecks, isDeckDrag, setDraggedDecks } from './deck-drag';

const TYPE = 'application/x-slider-deck-ids';

function dragEvent(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const dataTransfer = {
    effectAllowed: 'all',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()];
    },
  };
  return { event: { dataTransfer } as unknown as DragEvent, dataTransfer };
}

describe('deck drag', () => {
  it('round-trips the dragged ids and allows a move', () => {
    const { event, dataTransfer } = dragEvent();
    setDraggedDecks(event, ['a', 'b']);
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(isDeckDrag(event)).toBe(true);
    expect(draggedDecks(event)).toEqual(['a', 'b']);
  });

  it('ignores other drags', () => {
    const { event } = dragEvent({ 'text/plain': 'x' });
    expect(isDeckDrag(event)).toBe(false);
    expect(draggedDecks(event)).toEqual([]);
  });

  it('copes with malformed data', () => {
    expect(draggedDecks(dragEvent({ [TYPE]: '{' }).event)).toEqual([]);
    expect(draggedDecks(dragEvent({ [TYPE]: '{"a":1}' }).event)).toEqual([]);
    expect(draggedDecks(dragEvent({ [TYPE]: '["a",1,null,"b"]' }).event)).toEqual(['a', 'b']);
  });
});
