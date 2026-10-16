import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { cn, Dialog, IconButton } from '@/ui';
import { RecorderPanel } from './RecorderPanel';
import {
  addPoint,
  ERASER_WIDTH,
  hasInk,
  renderSketch,
  SKETCH_WIDTHS,
  sketchPalette,
  type SketchStroke,
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

/**
 * The Bild tab: a sheet to sketch on – pen in a few colours, two widths, eraser, undo – and a
 * voice memo that can run while drawing ("hier fehlt noch …"). Sending turns the sketch into a
 * PNG; the memo goes along as the comment's recording.
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
  const [undone, setUndone] = useState<SketchStroke[]>([]);
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
  useEffect(() => report(hasInk(strokes) ? { strokes, memo } : null), [strokes, memo]);

  const addStroke = (stroke: SketchStroke) => {
    setStrokes((current) => [...current, stroke]);
    setUndone([]);
  };
  const undo = () => {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    setStrokes(strokes.slice(0, -1));
    setUndone([...undone, last]);
  };
  const redo = () => {
    const next = undone[undone.length - 1];
    if (!next) return;
    setUndone(undone.slice(0, -1));
    setStrokes([...strokes, next]);
  };
  const clear = () => {
    setStrokes([]);
    setUndone([]);
  };

  /** Canvas and tools – inline in the composer, and again in the big view (same strokes). */
  const sheet = (big: boolean) => (
    <>
      <SketchCanvas
        strokes={strokes}
        aspect={aspect}
        tool={tool}
        color={penColor}
        width={tool === 'eraser' ? ERASER_WIDTH : bold ? SKETCH_WIDTHS.bold : SKETCH_WIDTHS.fine}
        onStroke={addStroke}
      />

      <div
        role="toolbar"
        aria-label="Zeichenwerkzeuge"
        className="flex items-center gap-1 rounded-control bg-white/5 p-1"
      >
        <IconButton
          size="sm"
          icon="gesture"
          label="Stift"
          active={tool === 'pen'}
          onClick={() => setTool('pen')}
        />
        <IconButton
          size="sm"
          icon="eraser"
          label="Radierer"
          active={tool === 'eraser'}
          onClick={() => setTool('eraser')}
        />
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        {palette.map((swatch) => {
          const selected = tool === 'pen' && swatch === penColor;
          return (
            <button
              key={swatch}
              type="button"
              aria-label={`Farbe ${swatch}`}
              aria-pressed={selected}
              title="Farbe"
              onClick={() => {
                setPenColor(swatch);
                setTool('pen');
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
          aria-label={bold ? 'Dünne Linie' : 'Dicke Linie'}
          title={bold ? 'Dünn' : 'Dick'}
          aria-pressed={bold}
          onClick={() => {
            setBold((value) => !value);
            setTool('pen');
          }}
          className={cn(
            'flex size-7 items-center justify-center rounded-control-sm hover:bg-white/10',
            bold && 'bg-white/15',
          )}
        >
          <span className={cn('rounded-full bg-fg', bold ? 'size-2.5' : 'size-1')} aria-hidden />
        </button>
        <span className="flex-1" />
        <IconButton
          size="sm"
          icon="undo"
          label="Rückgängig (⌘Z)"
          disabled={strokes.length === 0}
          onClick={undo}
        />
        <IconButton
          size="sm"
          icon="delete"
          label="Alles löschen"
          disabled={strokes.length === 0}
          onClick={clear}
        />
        <IconButton
          size="sm"
          icon={big ? 'closeFullscreen' : 'openInFull'}
          label={big ? 'Verkleinern (Esc)' : 'Groß zeichnen'}
          onClick={() => setExpanded(!big)}
        />
      </div>
    </>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
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
        <Dialog
          open
          onClose={() => setExpanded(false)}
          title="Bild zeichnen"
          className="w-auto! max-w-none"
        >
          {/* About 80 % of the screen, in the slide's format: limited by width or by height. */}
          <div
            className="flex flex-col gap-2"
            style={{ width: `min(calc(80vw - 48px), calc((80dvh - 160px) * ${aspect}))` }}
          >
            {sheet(true)}
          </div>
        </Dialog>
      )}

      {/* Talking while drawing: the memo records on while the pen moves. */}
      <RecorderPanel kind="audio" deckId={deckId} onChange={setMemo} />
    </div>
  );
}

/** The sheet: vector strokes repainted on every change, sharp at any pixel ratio. */
function SketchCanvas({
  strokes,
  aspect,
  tool,
  color,
  width,
  onStroke,
}: {
  strokes: readonly SketchStroke[];
  aspect: number;
  tool: SketchTool;
  color: string;
  width: number;
  onStroke: (stroke: SketchStroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState<SketchStroke | null>(null);

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
    renderSketch(context, current ? [...strokes, current] : strokes, canvas.width, canvas.height);
  }, [strokes, current, size]);

  const pointAt = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [
      clamp((event.clientX - box.left) / box.width),
      clamp((event.clientY - box.top) / box.height),
    ];
  };

  return (
    <canvas
      ref={canvasRef}
      aria-label="Zeichenfläche"
      className={cn(
        'w-full touch-none rounded-control shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]',
        tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair',
      )}
      style={{ aspectRatio: aspect }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setCurrent({ tool, color, width, points: [pointAt(event)] });
      }}
      onPointerMove={(event) => {
        if (!current) return;
        // Coalesced events: smooth lines even when the main thread is busy.
        const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
        const box = event.currentTarget.getBoundingClientRect();
        let points = current.points;
        for (const sample of events) {
          points = addPoint(points, [
            Math.min(1, Math.max(0, (sample.clientX - box.left) / box.width)),
            Math.min(1, Math.max(0, (sample.clientY - box.top) / box.height)),
          ]);
        }
        if (points !== current.points) setCurrent({ ...current, points });
      }}
      onPointerUp={() => {
        if (current) onStroke(current);
        setCurrent(null);
      }}
      onPointerCancel={() => setCurrent(null)}
    />
  );
}
