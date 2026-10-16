import type { AccentColor, Stroke } from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { ACCENT_COLOR_NAMES, accentColor } from '@/lib/accent';
import { Button, cn, IconButton, type IconName } from '@/ui';
import { isTypingTarget } from '../lib/dom';
import { RecorderPanel } from './RecorderPanel';
import { hasInk, sketchPalette } from './sketch';
import { SketchSheet, type SheetTool } from './SketchSheet';
import { useSheetEditor } from './useSheetEditor';
import type { Recording } from './useRecorder';

export interface Sketch {
  strokes: Stroke[];
  /** The voice memo recorded while drawing, if any. */
  memo: Recording | null;
}

interface SketchPanelProps {
  deckId: string;
  /** The viewer's colour – the first to draw in. */
  color: AccentColor;
  /** Shown on the tag of text being written. */
  authorName: string;
  /** Width / height of the sheet – the slide being commented on, so the sketch matches it. */
  aspect: number;
  /** The drawing so far, or `null` while the paper is empty. */
  onChange: (sketch: Sketch | null) => void;
  autoFocus?: boolean;
  /** Tab / Shift+Tab out of the panel – the composer moves to the next or previous format. */
  onTab?: (backwards: boolean) => void;
  /** Sending and cancelling the comment, also right from the big view. */
  actions?: SketchActions;
}

export interface SketchActions {
  canSend: boolean;
  pending: boolean;
  onSend: () => void;
  onCancel: () => void;
}

/** The slide's tool bar: pointer (drag = box, typing writes into it), pens, eraser. */
const TOOLS: { tool: SheetTool; icon: IconName; label: string }[] = [
  {
    tool: null,
    icon: 'cursor',
    label: 'Zeiger: ziehen = Box (Tippen schreibt hinein), Doppelklick = Text, Klick wählt aus',
  },
  { tool: 'pen', icon: 'gesture', label: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer: Striche und Boxen wegwischen' },
];

/**
 * The Bild tab: an empty slide to draw on with the slide's own tools – freehand, arrow, marker,
 * boxes, text, eraser – in the reviewer colours, with undo, and a voice memo that can run while
 * drawing ("hier fehlt noch …"). Sending turns the sketch into a PNG; the memo goes along as the
 * comment's recording.
 */
export function SketchPanel({
  deckId,
  color,
  authorName,
  aspect,
  onChange,
  autoFocus = false,
  onTab,
  actions,
}: SketchPanelProps) {
  const editor = useSheetEditor();
  const { strokes, selected } = editor;
  // The pointer first, as on the slide.
  const [tool, setTool] = useState<SheetTool>(null);
  const [penColor, setPenColor] = useState<AccentColor>(color);
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

  const selectedStroke = selected === null ? undefined : strokes[selected];

  const toolButtons = TOOLS.map((option) => (
    <IconButton
      key={option.tool ?? 'pointer'}
      size="sm"
      icon={option.icon}
      label={option.label}
      active={tool === option.tool}
      onClick={() => {
        editor.select(null);
        setTool(option.tool);
      }}
    />
  ));

  const colorButtons = sketchPalette(color).map((swatch) => {
    const picked = (selectedStroke?.color ?? penColor) === swatch;
    return (
      <button
        key={swatch}
        type="button"
        aria-label={`Farbe ${ACCENT_COLOR_NAMES[swatch]}`}
        aria-pressed={picked}
        title={selectedStroke ? 'Farbe der Auswahl' : 'Farbe'}
        onClick={() => {
          setPenColor(swatch);
          // A selected mark takes the colour too.
          if (selected !== null && selectedStroke)
            editor.replace(selected, { ...selectedStroke, color: swatch });
        }}
        className="flex size-7 items-center justify-center rounded-full hover:bg-white/10"
      >
        <span
          className={cn(
            'size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]',
            picked && 'ring-2 ring-white/80 ring-offset-2 ring-offset-[#1f1f1f]',
          )}
          style={{ backgroundColor: accentColor(swatch) }}
        />
      </button>
    );
  });

  const actionButtons = (big: boolean) => (
    <>
      <IconButton
        size="sm"
        icon="undo"
        label="Rückgängig (⌘Z)"
        disabled={!editor.canUndo}
        onClick={editor.undo}
      />
      <IconButton
        size="sm"
        icon="delete"
        label={selectedStroke ? 'Auswahl löschen (Entf)' : 'Alles löschen'}
        disabled={strokes.length === 0}
        onClick={() => (selected !== null ? editor.remove(selected) : editor.clear())}
      />
      <IconButton
        size="sm"
        icon={big ? 'closeFullscreen' : 'openInFull'}
        label={big ? 'Verkleinern (Esc)' : 'Groß zeichnen'}
        onClick={() => {
          editor.select(null);
          setExpanded(!big);
        }}
      />
    </>
  );

  const divider = <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />;

  /** Sheet and tools – inline in the composer, and again in the big view (same drawing). */
  const sheet = (big: boolean) => (
    <>
      <SketchSheet
        editor={editor}
        aspect={aspect}
        tool={tool}
        color={penColor}
        authorName={authorName}
        // While the big view is open, the composer's sheet only shows the drawing.
        interactive={big || !expanded}
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

  /** From the big view: back to the composer, then send – its progress shows there. */
  const send = () => {
    if (!actions?.canSend || actions.pending) return;
    editor.select(null);
    setExpanded(false);
    actions.onSend();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    // ⌘↵ sends from the big view too (the viewer's shortcut stays out of dialogs).
    if (expanded && mod && event.key === 'Enter' && actions) {
      event.preventDefault();
      send();
      return;
    }
    // Writing on the sheet: the text field's own keys (⌘Z undoes typing).
    if (event.nativeEvent.isComposing || isTypingTarget(event.target)) return;
    if (mod && event.key.toLowerCase() === 'z') {
      // Before the viewer's own ⌘Z, which undoes strokes on the slide.
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
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
        <SketchFullscreen
          aspect={aspect}
          onClose={() => {
            editor.select(null);
            setExpanded(false);
          }}
          actions={
            actions && (
              <>
                <Button variant="ghost" size="sm" onClick={actions.onCancel}>
                  Abbrechen
                </Button>
                <Button
                  size="sm"
                  icon="send"
                  title="⌘↵"
                  disabled={!actions.canSend}
                  loading={actions.pending}
                  onClick={send}
                >
                  Senden
                </Button>
              </>
            )
          }
        >
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
  actions,
  children,
}: {
  aspect: number;
  onClose: () => void;
  /** Send and cancel the comment; without them, a close button. */
  actions?: ReactNode;
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
            {actions ? (
              <div className="flex items-center gap-1">{actions}</div>
            ) : (
              <IconButton
                icon="close"
                label="Schließen (Esc)"
                size="sm"
                onClick={onClose}
                className="glass-control rounded-full"
              />
            )}
          </header>
          {children}
        </div>
      </div>
    </dialog>
  );
}
