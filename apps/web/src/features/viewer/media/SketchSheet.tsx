import {
  distance,
  isTextStroke,
  MIN_DRAG_DISTANCE,
  rectFromPoints,
  type AccentColor,
  type PathStroke,
  type Point,
  type Rect,
  type Stroke,
} from '@slider/shared';
import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { accentColor } from '@/lib/accent';
import { cn } from '@/ui';
import { toSlidePoint } from '../lib/geometry';
import { appendPoint, strokePath } from '../lib/stroke-path';
import { clickTextBox, dragTextBox, startFontSize } from '../lib/text-box';
import type { PenTool } from '../state/viewer-state';
import { EditableFrame } from '../stage/EditableFrame';
import { RectFrame } from '../stage/RectFrame';
import { StrokePath } from '../stage/StrokePath';
import { TextBoxField, TextMark } from '../stage/TextBox';
import { boxOf, eraserHits, frameOf, placeStroke } from './sketch';
import type { SheetEditor } from './useSheetEditor';

/** The slide's tools: the pointer (`null` – drag a box, write into it), the pens, the eraser. */
export type SheetTool = PenTool | 'eraser' | null;

interface SketchSheetProps {
  editor: SheetEditor;
  aspect: number;
  tool: SheetTool;
  color: AccentColor;
  /** Shown on the tag of the text being written. */
  authorName: string;
  /** Off: only shows the drawing (the composer's sheet while the big view is open). */
  interactive: boolean;
  big?: boolean;
  sheetRef?: RefObject<HTMLDivElement | null>;
}

const MAX_POINTS = 2000;

/**
 * An empty slide to draw on, with the slide's own marks and gestures: freehand, arrow and marker
 * strokes, boxes dragged with the pointer (typing or a double click writes into one), text boxes,
 * the eraser. A click selects a mark – drag it to move it, its corners resize it, Entf deletes it.
 */
export function SketchSheet({
  editor,
  aspect,
  tool,
  color,
  authorName,
  interactive,
  big = false,
  sheetRef,
}: SketchSheetProps) {
  const { strokes, selected, text } = editor;
  const [dragBox, setDragBox] = useState<{ start: Point; rect: Rect | null } | null>(null);
  const [drawing, setDrawing] = useState<PathStroke | null>(null);
  /** Strokes the eraser has touched in this wipe – hidden now, removed when it ends. */
  const [erasing, setErasing] = useState<ReadonlySet<number> | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  const hidden = (index: number) => erasing?.has(index) || text?.index === index;
  const selectedStroke = selected === null ? undefined : strokes[selected];
  const pointOf = (event: { clientX: number; clientY: number }) =>
    element ? toSlidePoint(event, element) : null;
  const fontSize = () => startFontSize(element?.offsetHeight ?? 0);

  /** Typing or a double click on a box: it becomes a text box, as on the slide. */
  const writeInto = (index: number, first = '') => {
    const stroke = strokes[index];
    const rect = stroke && boxOf(stroke);
    if (!stroke || !rect) return;
    editor.startText({
      box: { ...dragTextBox(rect, fontSize()), text: first, measured: null },
      color: stroke.color,
      index,
    });
  };

  const editText = (index: number) => {
    const stroke = strokes[index];
    if (!stroke || !isTextStroke(stroke)) return;
    const { x, y, w, h } = stroke;
    editor.startText({
      box: {
        x,
        y,
        width: w,
        minHeight: h,
        fontSize: stroke.fontSize,
        text: stroke.text,
        measured: { x, y, w, h },
      },
      color: stroke.color,
      index,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || selected === null || !selectedStroke) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    const box = boxOf(selectedStroke) !== null;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      editor.remove(selected);
    } else if (event.key === 'Escape') {
      // Before the big view or the composer: Esc first lets go of the mark.
      event.preventDefault();
      event.stopPropagation();
      editor.select(null);
    } else if (event.key === 'Enter' && isTextStroke(selectedStroke)) {
      event.preventDefault();
      editText(selected);
    } else if (box && (event.key === 'Enter' || event.key.length === 1)) {
      event.preventDefault();
      writeInto(selected, event.key.length === 1 ? event.key : '');
    }
  };

  const sheetEvents = interactive && {
    onKeyDown,
    // The pointer on the empty sheet: a drag draws a box, a click lets go of the selection.
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || tool !== null) return;
      const start = pointOf(event);
      if (!start) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      editor.select(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragBox({ start, rect: null });
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const point = dragBox && pointOf(event);
      if (!dragBox || !point) return;
      if (dragBox.rect || distance(dragBox.start, point) >= MIN_DRAG_DISTANCE)
        setDragBox({ ...dragBox, rect: rectFromPoints(dragBox.start, point) });
    },
    onPointerUp: () => {
      const rect = dragBox?.rect;
      setDragBox(null);
      if (!rect) return;
      const box: Stroke = {
        tool: 'rect',
        color,
        points: [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.w, y: rect.y + rect.h },
        ],
      };
      // Selected right away: typing writes into it, as on the slide.
      editor.commit([...strokes, box], strokes.length);
    },
    onPointerCancel: () => setDragBox(null),
    onDoubleClick: (event: MouseEvent<HTMLDivElement>) => {
      if (tool !== null) return;
      const point = pointOf(event);
      if (!point) return;
      editor.startText({
        box: { ...clickTextBox(point, fontSize()), text: '', measured: null },
        color,
        index: null,
      });
    },
  };

  /** `touched` plus every stroke the eraser at the pointer reaches. */
  const touchedBy = (event: { clientX: number; clientY: number }, touched: Set<number>) => {
    const box = element?.getBoundingClientRect();
    if (!box) return touched;
    const p = { x: event.clientX - box.left, y: event.clientY - box.top };
    strokes.forEach((stroke, index) => {
      if (eraserHits(stroke, p, box.width, box.height)) touched.add(index);
    });
    return touched;
  };

  const pathStrokes = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(
      (item): item is { stroke: PathStroke; index: number } =>
        !isTextStroke(item.stroke) && item.stroke.tool !== 'rect' && !hidden(item.index),
    );

  return (
    <div
      ref={(node) => {
        setElement(node);
        if (sheetRef) sheetRef.current = node;
      }}
      tabIndex={interactive ? -1 : undefined}
      aria-label="Zeichenfläche"
      // While a box is selected the sheet takes the letter keys (`Composer`).
      data-sketch-keys={selectedStroke && boxOf(selectedStroke) ? '' : undefined}
      {...sheetEvents}
      className={cn(
        'relative w-full touch-none bg-white outline-none select-none [container-type:size]',
        big
          ? 'rounded-panel shadow-(--shadow-float)'
          : 'rounded-control shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]',
        interactive && tool === null && 'cursor-crosshair',
      )}
      style={{ aspectRatio: aspect }}
    >
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {pathStrokes.map(({ stroke, index }) => (
          <g key={index}>
            <StrokePath stroke={stroke} aspectRatio={aspect} emphasized={selected === index} />
            {interactive && tool === null && (
              // A wider invisible line: easy to click.
              <path
                {...hitPathProps(stroke, aspect)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  element?.focus({ preventScroll: true });
                  editor.select(index);
                }}
              />
            )}
          </g>
        ))}
        {drawing && <StrokePath stroke={drawing} aspectRatio={aspect} />}
      </svg>

      {strokes.map((stroke, index) => {
        if (hidden(index)) return null;
        const isSelected = selected === index;
        const select = () => {
          element?.focus({ preventScroll: true });
          editor.select(index);
        };
        if (isTextStroke(stroke))
          return (
            <TextMark
              key={index}
              stroke={stroke}
              label={`„${stroke.text}“`}
              opacity={1}
              emphasized={isSelected}
              interactive={interactive && tool === null}
              onActivate={select}
              onDoubleClick={() => editText(index)}
              onPlace={(rect, done) => {
                editor.replace(index, { ...stroke, ...rect });
                done();
              }}
            />
          );
        const box = boxOf(stroke);
        if (box)
          return interactive && tool === null ? (
            <EditableFrame
              key={index}
              rect={box}
              color={accentColor(stroke.color)}
              handles={isSelected}
              emphasized={isSelected}
              // Unselected, only its border takes the pointer: what lies inside stays reachable.
              edgesOnly={!isSelected}
              title="Ziehen zum Verschieben, Ecken zum Ändern der Größe, Tippen schreibt hinein"
              onActivate={select}
              onDoubleClick={() => writeInto(index)}
              onCommit={(rect, done) => {
                editor.replace(index, placeStroke(stroke, box, rect));
                done();
              }}
            />
          ) : (
            <RectFrame key={index} rect={box} color={accentColor(stroke.color)} />
          );
        // A selected drawing: a dashed frame around it moves and scales it.
        const frame = isSelected && interactive && tool === null ? frameOf(stroke) : null;
        return (
          frame && (
            <EditableFrame
              key={index}
              rect={frame}
              color={accentColor(stroke.color)}
              handles
              className="border-dashed"
              title="Ziehen zum Verschieben, Ecken zum Ändern der Größe, Entf löscht"
              onCommit={(rect, done) => {
                editor.replace(index, placeStroke(stroke, frame, rect));
                done();
              }}
            />
          )
        );
      })}

      {dragBox?.rect && <RectFrame rect={dragBox.rect} color={accentColor(color)} dashed />}

      {interactive && (tool === 'pen' || tool === 'arrow' || tool === 'highlighter') && (
        <div
          className="absolute inset-0 z-20 cursor-crosshair touch-none"
          onPointerDown={(event) => {
            const point = pointOf(event);
            if (event.button !== 0 || !point) return;
            event.preventDefault();
            editor.select(null);
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrawing({ tool, color, points: [point] });
          }}
          onPointerMove={(event) => {
            const point = pointOf(event);
            if (!drawing || !point) return;
            // Coalesced events: smooth lines even when the main thread is busy.
            const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
            let points = drawing.points;
            for (const sample of samples) {
              const at = pointOf(sample);
              if (at) points = appendPoint(points, at);
            }
            if (points !== drawing.points && points.length <= MAX_POINTS)
              setDrawing({ ...drawing, points });
          }}
          onPointerUp={() => {
            if (!drawing) return;
            setDrawing(null);
            // A tap still leaves a dot: a stroke needs two points.
            const [first] = drawing.points;
            const points = drawing.points.length >= 2 || !first ? drawing.points : [first, first];
            editor.commit([...strokes, { ...drawing, points }]);
          }}
          onPointerCancel={() => setDrawing(null)}
        />
      )}

      {interactive && tool === 'eraser' && (
        <div
          className="absolute inset-0 z-20 cursor-cell touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            editor.select(null);
            event.currentTarget.setPointerCapture(event.pointerId);
            setErasing(touchedBy(event, new Set()));
          }}
          onPointerMove={(event) => {
            if (!erasing) return;
            const touched = touchedBy(event, new Set(erasing));
            if (touched.size !== erasing.size) setErasing(touched);
          }}
          onPointerUp={() => {
            if (erasing && erasing.size > 0)
              editor.commit(strokes.filter((_, index) => !erasing.has(index)));
            setErasing(null);
          }}
          onPointerCancel={() => setErasing(null)}
        />
      )}

      {interactive && text && (
        <TextBoxField
          box={text.box}
          author={{ name: authorName, color: text.color }}
          onChange={editor.changeText}
          onMeasured={editor.measureText}
          onLeave={() => {
            editor.finishText();
            element?.focus({ preventScroll: true });
            return true;
          }}
          onEscape={() => {
            editor.finishText();
            element?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

/** Invisible, wider copy of a drawing that takes the clicks selecting it. */
function hitPathProps(stroke: PathStroke, aspect: number) {
  return {
    d: strokePath(stroke, aspect),
    fill: 'none',
    stroke: 'transparent',
    strokeWidth: 16,
    strokeLinecap: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
    pointerEvents: 'stroke' as const,
    className: 'cursor-pointer',
  };
}
