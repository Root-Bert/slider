import { isTextStroke, type AccentColor, type Rect, type Stroke } from '@slider/shared';
import { useState } from 'react';
import { textStrokeFromDraft } from '../lib/text-box';
import type { TextBoxDraft, TextBoxPatch } from '../state/viewer-state';

/** Text being written: into a new box, or replacing the stroke at `index` (a box or a text). */
export interface SheetText {
  box: TextBoxDraft;
  color: AccentColor;
  index: number | null;
}

/**
 * State of the Bild sheet: its strokes with undo/redo, what is selected and the text being
 * written. Shared by the sheet in the composer and the big view.
 */
export function useSheetEditor() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Undo and redo step through whole states, so moving, erasing and clearing are undone too.
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState<SheetText | null>(null);

  const commit = (next: Stroke[], select: number | null = null) => {
    setPast([...past, strokes]);
    setFuture([]);
    setStrokes(next);
    setSelected(select);
  };

  const finishText = () => {
    if (!text) return;
    setText(null);
    const stroke = textStrokeFromDraft(text.box, text.color);
    const { index } = text;
    const replaced = index === null ? undefined : strokes[index];
    if (!stroke) {
      // Emptied text goes; an empty box written into stays a box.
      if (replaced && isTextStroke(replaced)) commit(strokes.filter((_, other) => other !== index));
      return;
    }
    if (index === null) commit([...strokes, stroke]);
    else commit(strokes.map((other, at) => (at === index ? stroke : other)));
  };

  return {
    strokes,
    selected,
    text,
    canUndo: past.length > 0,
    commit,
    replace: (index: number, stroke: Stroke) =>
      commit(
        strokes.map((other, at) => (at === index ? stroke : other)),
        index,
      ),
    remove: (index: number) => commit(strokes.filter((_, other) => other !== index)),
    select: (index: number | null) => {
      finishText();
      setSelected(index);
    },
    undo: () => {
      const previous = past.at(-1);
      if (!previous) return;
      setText(null);
      setSelected(null);
      setPast(past.slice(0, -1));
      setFuture([...future, strokes]);
      setStrokes(previous);
    },
    redo: () => {
      const next = future.at(-1);
      if (!next) return;
      setText(null);
      setSelected(null);
      setFuture(future.slice(0, -1));
      setPast([...past, strokes]);
      setStrokes(next);
    },
    clear: () => {
      setText(null);
      commit([]);
    },
    startText: (next: SheetText) => {
      setSelected(null);
      setText(next);
    },
    // Typing and measuring interleave: both build on the latest text, not this render's.
    changeText: (patch: TextBoxPatch) =>
      setText((current) => {
        if (!current) return current;
        const box = { ...current.box, ...patch };
        // Moving keeps the measured size until the field reports the new box.
        const measured = box.measured && { ...box.measured, x: box.x, y: box.y };
        return { ...current, box: { ...box, measured } };
      }),
    measureText: (rect: Rect) =>
      setText((current) => {
        const measured = current?.box.measured;
        if (
          !current ||
          (measured && (['x', 'y', 'w', 'h'] as const).every((key) => measured[key] === rect[key]))
        )
          return current;
        return { ...current, box: { ...current.box, measured: rect } };
      }),
    finishText,
  };
}

export type SheetEditor = ReturnType<typeof useSheetEditor>;
