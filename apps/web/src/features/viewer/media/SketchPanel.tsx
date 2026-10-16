import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn, IconButton, type IconName } from '@/ui';
import { isTypingTarget } from '../lib/dom';
import { RecorderPanel } from './RecorderPanel';
import {
  addPoint,
  eraserHits,
  hasInk,
  isTwoPointTool,
  renderSketch,
  SKETCH_FONT_SIZES,
  SKETCH_LINE_HEIGHT,
  SKETCH_WIDTHS,
  sketchFont,
  sketchPalette,
  textAt,
  type SketchPathStroke,
  type SketchStroke,
  type SketchTextStroke,
  type SketchTool,
} from './sketch';
import type { Recording } from './useRecorder';

export interface Sketch {
  strokes: SketchStroke[];
  /** The voice memo recorded while drawing, if any. */
  memo: Recording | null;
}

interface SketchPanelProps {
  deckId: string;
  /** The viewer's colour – the second pen colour after white. */
  color: string;
  /** Width / height of the sheet – the slide being commented on, so the sketch matches it. */
  aspect: number;
  /** The drawing so far, or `null` while the paper is empty. */
  onChange: (sketch: Sketch | null) => void;
  autoFocus?: boolean;
  /** Tab / Shift+Tab out of the panel – the composer moves to the next or previous format. */
  onTab?: (backwards: boolean) => void;
}

/** The tools of the slide's tool bar, plus box and text (on the slide: drag and type). */
const TOOLS: { tool: SketchTool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker' },
  { tool: 'rect', icon: 'cropSquare', label: 'Box' },
  { tool: 'text', icon: 'textFields', label: 'Text' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer: Striche wegwischen' },
];

/**
 * The Bild tab: a sheet to sketch on with the slide's tools – freehand, arrow, marker, box, text,
 * eraser – in a few colours and two widths, with undo, and a voice memo that can run while
 * drawing ("hier fehlt noch …"). Sending turns the sketch into a PNG; the memo goes along as the
 * comment's recording.
 */
export function SketchPanel({
  deckId,
  color,
  aspect,
  onChange,
  autoFocus = false,
  onTab,
}: SketchPanelProps) {
  const palette = sketchPalette(color);
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  // Undo and redo step through whole states, so erasing and clearing are undone too.
  const [past, setPast] = useState<SketchStroke[][]>([]);
  const [future, setFuture] = useState<SketchStroke[][]>([]);
  const [tool, setTool] = useState<SketchTool>('pen');
  const [penColor, setPenColor] = useState(palette[0] ?? '#141414');
  const [bold, setBold] = useState(false);
  const [memo, setMemo] = useState<Recording | null>(null);
  /** The sheet blown up to most of the screen, for drawing with room to move. */
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const report = useEffectEvent((value: Sketch | null) => onChange(value));
  useEffect(() => {
    report(hasInk(strokes) ? { strokes, memo } : null);
  }, [strokes, memo]);

  const commit = (next: SketchStroke[]) => {
    setPast([...past, strokes]);
    setFuture([]);
    setStrokes(next);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([...future, strokes]);
    setStrokes(previous);
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    setFuture(future.slice(0, -1));
    setPast([...past, strokes]);
    setStrokes(next);
  };

  const size = bold ? 'bold' : 'fine';
  const lineWidth = tool === 'text' || tool === 'eraser' ? 0 : SKETCH_WIDTHS[tool][size];

  const toolButtons = TOOLS.map((option) => (
    <IconButton
      key={option.tool}
      size="sm"
      icon={option.icon}
      label={option.label}
      active={tool === option.tool}
      onClick={() => setTool(option.tool)}
    />
  ));

  const colorButtons = (
    <>
      {palette.map((swatch) => {
        const selected = tool !== 'eraser' && swatch === penColor;
        return (
          <button
            key={swatch}
            type="button"
            aria-label={`Farbe ${swatch}`}
            aria-pressed={selected}
            title="Farbe"
            onClick={() => {
              setPenColor(swatch);
              if (tool === 'eraser') setTool('pen');
            }}
            className="flex size-7 items-center justify-center rounded-full hover:bg-white/10"
          >
            <span
              className={cn(
                'size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]',
                selected && 'ring-2 ring-white/80 ring-offset-2 ring-offset-[#1f1f1f]',
              )}
              style={{ backgroundColor: swatch }}
            />
          </button>
        );
      })}
      <button
        type="button"
        aria-label={bold ? 'Dünne Linie, kleine Schrift' : 'Dicke Linie, große Schrift'}
        title={bold ? 'Dünn' : 'Dick'}
        aria-pressed={bold}
        onClick={() => setBold((value) => !value)}
        className={cn(
          'flex size-7 items-center justify-center rounded-control-sm hover:bg-white/10',
          bold && 'bg-white/15',
        )}
      >
        <span className={cn('rounded-full bg-fg', bold ? 'size-2.5' : 'size-1')} aria-hidden />
      </button>
    </>
  );

  const actionButtons = (big: boolean) => (
    <>
      <IconButton
        size="sm"
        icon="undo"
        label="Rückgängig (⌘Z)"
        disabled={past.length === 0}
        onClick={undo}
      />
      <IconButton
        size="sm"
        icon="delete"
        label="Alles löschen"
        disabled={strokes.length === 0}
        onClick={() => commit([])}
      />
      <IconButton
        size="sm"
        icon={big ? 'closeFullscreen' : 'openInFull'}
        label={big ? 'Verkleinern (Esc)' : 'Groß zeichnen'}
        onClick={() => setExpanded(!big)}
      />
    </>
  );

  const divider = <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />;

  /** Canvas and tools – inline in the composer, and again in the big view (same strokes). */
  const sheet = (big: boolean) => (
    <>
      <SketchCanvas
        strokes={strokes}
        aspect={aspect}
        tool={tool}
        color={penColor}
        width={lineWidth}
        fontSize={SKETCH_FONT_SIZES[size]}
        onCommit={commit}
        big={big}
      />

      {big ? (
        // A floating glass pill like the viewer's tool bar.
        <div
          role="toolbar"
          aria-label="Zeichenwerkzeuge"
          className="glass-control flex items-center gap-1 rounded-panel p-1"
        >
          {toolButtons}
          {divider}
          {colorButtons}
          {divider}
          {actionButtons(true)}
        </div>
      ) : (
        // The composer is narrow: tools and actions, then the colours below.
        <div
          role="toolbar"
          aria-label="Zeichenwerkzeuge"
          className="flex flex-col gap-0.5 rounded-control bg-white/5 p-1"
        >
          <div className="flex items-center gap-1">
            {toolButtons}
            <span className="flex-1" />
            {actionButtons(false)}
          </div>
          <div className="flex items-center gap-1">{colorButtons}</div>
        </div>
      )}
    </>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Writing on the sheet: the text field's own keys (⌘Z undoes typing).
    if (event.nativeEvent.isComposing || isTypingTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') {
      // Before the viewer's own ⌘Z, which undoes strokes on the slide.
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.target !== rootRef.current || mod || event.altKey) return;
    // Letters write the comment (`Composer`), so the tools have no letter keys.
    if (event.key === 'Tab' && onTab) {
      event.preventDefault();
      onTab(event.shiftKey);
    }
  };

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label="Bild zeichnen – ⌘Z: rückgängig"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2 rounded-control outline-none"
    >
      {sheet(false)}

      {expanded && (
        <SketchFullscreen aspect={aspect} onClose={() => setExpanded(false)}>
          {sheet(true)}
        </SketchFullscreen>
      )}

      {/* Talking while drawing: the memo records on while the pen moves. */}
      <RecorderPanel kind="audio" deckId={deckId} onChange={setMemo} />
    </div>
  );
}

/**
 * The big view: the sheet at about 80 % of the screen in the slide's format, centred on a dimmed
 * backdrop, the tools as a floating pill below. A modal <dialog> – on top of the reply dialog
 * too, Esc and a click beside the sheet close it. It stays a DOM child of the panel, so ⌘Z still
 * reaches the panel's key handler.
 */
function SketchFullscreen({
  aspect,
  onClose,
  children,
}: {
  aspect: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // The dialog itself takes focus, not its first button (no focus ring on open).
    dialog.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  const closeOnBackdrop = (event: MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label="Bild zeichnen"
      onClose={(event) => {
        // Not the reply dialog around it: its `onClose` would otherwise see this one close.
        event.stopPropagation();
        if (!event.currentTarget.open) onClose();
      }}
      onClick={closeOnBackdrop}
      className="m-0 size-full max-h-none max-w-none border-0 bg-transparent p-0 text-fg outline-none backdrop:bg-black/75 backdrop:backdrop-blur-md open:animate-fade-in"
    >
      <div onClick={closeOnBackdrop} className="flex size-full items-center justify-center p-6">
        {/* Header and tools take ~160px; the sheet gets the rest, at most 80 % of the screen. */}
        <div
          className="flex animate-pop-in flex-col items-center gap-3"
          style={{ width: `min(80vw, calc(min(80dvh, 100dvh - 160px) * ${aspect}))` }}
        >
          <header className="flex w-full items-center justify-between gap-4">
            <h2 className="text-sm font-medium text-fg">Bild zeichnen</h2>
            <IconButton
              icon="close"
              label="Schließen (Esc)"
              size="sm"
              onClick={onClose}
              className="glass-control rounded-full"
            />
          </header>
          {children}
        </div>
      </div>
    </dialog>
  );
}

/** Text being written: a new box (`index` null) or an existing one taken off the sheet. */
type TextEdit = Omit<SketchTextStroke, 'tool'> & { index: number | null };

/** Room a new text box keeps to the right edge, and its margin there (relative). */
const TEXT_ROOM = 0.15;
const TEXT_MARGIN = 0.02;

/**
 * The sheet: vector strokes repainted on every change, sharp at any pixel ratio. Drawing tools
 * add a stroke, the eraser wipes whole strokes, the text tool opens a field on the sheet (on a
 * text: edits it). Every change goes to `onCommit` as the new list – one undo step each.
 */
function SketchCanvas({
  strokes,
  aspect,
  tool,
  color,
  width,
  fontSize,
  onCommit,
  big = false,
}: {
  strokes: SketchStroke[];
  aspect: number;
  tool: SketchTool;
  color: string;
  /** Line width of the drawing tools (relative to the canvas width). */
  width: number;
  /** Size of new text (relative to the canvas height). */
  fontSize: number;
  onCommit: (strokes: SketchStroke[]) => void;
  /** In the big view: the sheet floats on the backdrop. */
  big?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState<SketchPathStroke | null>(null);
  /** Strokes the eraser has touched in this drag – hidden now, removed when the drag ends. */
  const [erasing, setErasing] = useState<ReadonlySet<number> | null>(null);
  const [editing, setEditingState] = useState<TextEdit | null>(null);
  // Finishing a text can come twice (pointer down elsewhere, then blur): only the first counts.
  const editingRef = useRef<TextEdit | null>(null);
  const setEditing = (next: TextEdit | null) => {
    editingRef.current = next;
    setEditingState(next);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const visible = strokes.filter((_, index) => !erasing?.has(index) && index !== editing?.index);
    renderSketch(context, current ? [...visible, current] : visible, canvas.width, canvas.height);
  }, [strokes, current, erasing, editing, size]);

  /** Pointer position relative to the sheet (0–1) and in CSS px. */
  const locate = (event: { clientX: number; clientY: number }) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return null;
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    return {
      point: [x, y] as [number, number],
      px: [x * box.width, y * box.height] as [number, number],
      box,
    };
  };

  const eraseAt = (event: { clientX: number; clientY: number }, touched: Set<number>) => {
    const context = canvasRef.current?.getContext('2d');
    const at = locate(event);
    if (!context || !at) return;
    strokes.forEach((stroke, index) => {
      if (!touched.has(index) && eraserHits(context, stroke, at.px, at.box.width, at.box.height))
        touched.add(index);
    });
  };

  const finishText = () => {
    const edit = editingRef.current;
    if (!edit) return;
    setEditing(null);
    const { index, ...rest } = edit;
    const text = rest.text.trim();
    const stroke: SketchTextStroke = { tool: 'text', ...rest, text };
    if (index === null) {
      if (text) onCommit([...strokes, stroke]);
      return;
    }
    const before = strokes[index];
    if (!text) onCommit(strokes.filter((_, other) => other !== index));
    else if (before?.tool !== 'text' || before.text !== text)
      onCommit(strokes.map((other, at) => (at === index ? stroke : other)));
  };

  const startText = (event: PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext('2d');
    const at = locate(event);
    if (!context || !at) return;
    const index = textAt(context, strokes, at.px, at.box.width, at.box.height);
    const existing = strokes[index];
    if (existing?.tool === 'text') {
      setEditing({ ...existing, index });
      return;
    }
    const x = Math.min(at.point[0], 1 - TEXT_ROOM);
    // The first line fits on the sheet.
    const y = Math.min(at.point[1], Math.max(0, 1 - fontSize * SKETCH_LINE_HEIGHT));
    setEditing({ index: null, color, x, y, w: 1 - x - TEXT_MARGIN, text: '', fontSize });
  };

  return (
    <div className="relative w-full" style={{ aspectRatio: aspect }}>
      <canvas
        ref={canvasRef}
        aria-label="Zeichenfläche"
        className={cn(
          'absolute inset-0 size-full touch-none',
          big
            ? 'rounded-panel shadow-(--shadow-float)'
            : 'rounded-control shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]',
          tool === 'eraser' ? 'cursor-cell' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair',
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          // A click beside the text being written finishes it.
          if (editingRef.current) {
            finishText();
            return;
          }
          if (tool === 'text') {
            startText(event);
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          if (tool === 'eraser') {
            const touched = new Set<number>();
            eraseAt(event, touched);
            setErasing(touched);
            return;
          }
          const at = locate(event);
          if (at) setCurrent({ tool, color, width, points: [at.point] });
        }}
        onPointerMove={(event) => {
          if (erasing) {
            const touched = new Set(erasing);
            eraseAt(event, touched);
            if (touched.size !== erasing.size) setErasing(touched);
            return;
          }
          if (!current) return;
          const at = locate(event);
          if (!at) return;
          // Arrow and box: from where the drag started to the pointer.
          if (isTwoPointTool(current.tool)) {
            setCurrent({ ...current, points: [current.points[0] ?? at.point, at.point] });
            return;
          }
          // Coalesced events: smooth lines even when the main thread is busy.
          const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
          let points = current.points;
          for (const sample of events) {
            const position = locate(sample);
            if (position) points = addPoint(points, position.point);
          }
          if (points !== current.points) setCurrent({ ...current, points });
        }}
        onPointerUp={() => {
          if (erasing) {
            if (erasing.size > 0) onCommit(strokes.filter((_, index) => !erasing.has(index)));
            setErasing(null);
            return;
          }
          if (!current) return;
          setCurrent(null);
          const [start, end] = [current.points[0], current.points.at(-1)];
          // A click with the arrow or box draws nothing.
          if (
            isTwoPointTool(current.tool) &&
            (!start || !end || Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.01)
          )
            return;
          onCommit([...strokes, current]);
        }}
        onPointerCancel={() => {
          setCurrent(null);
          setErasing(null);
        }}
      />
      {editing && size.height > 0 && (
        <TextEditor
          edit={editing}
          height={size.height}
          onChange={(text) => setEditing({ ...editing, text })}
          onDone={finishText}
          onCancel={() => {
            // An existing text stays as it was.
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** The field for text on the sheet: same font, size and wrapping as the text drawn later. */
function TextEditor({
  edit,
  height,
  onChange,
  onDone,
  onCancel,
}: {
  edit: TextEdit;
  /** Height of the sheet in px – the font size is relative to it. */
  height: number;
  onChange: (text: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  // Grows with the text.
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [edit.text, height]);

  return (
    <textarea
      ref={ref}
      aria-label="Text auf dem Bild"
      rows={1}
      value={edit.text}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          // Not the big view's dialog: Esc only drops the text.
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onDone();
        }
      }}
      className="absolute resize-none overflow-hidden rounded-[2px] border-0 bg-transparent p-0 outline-1 outline-offset-2 outline-black/30 outline-dashed"
      style={{
        left: `${edit.x * 100}%`,
        top: `${edit.y * 100}%`,
        width: `${edit.w * 100}%`,
        font: sketchFont(edit.fontSize, height),
        lineHeight: SKETCH_LINE_HEIGHT,
        color: edit.color,
        caretColor: edit.color,
      }}
    />
  );
}
