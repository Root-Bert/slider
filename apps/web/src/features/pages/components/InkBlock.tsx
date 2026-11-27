import type { AccentColor } from '@slider/shared';
import { $getNodeByKey, type NodeKey } from 'lexical';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { accentColor, ACCENT_COLOR_NAMES } from '@/lib/accent';
import { cn, ColorSwatches, IconButton, Toolbar, ToolbarDivider, type IconName } from '@/ui';
import {
  addStrokes,
  INK_GROW,
  INK_WIDTH,
  inkPath,
  parseInk,
  removeLines,
  setHeight,
  touches,
  type InkColor,
  type InkPoint,
  type InkStroke,
  type InkTool,
} from '../lib/ink';
import { $isRawBlockNode } from '../lib/nodes';
import { useBlockPick } from './useBlockPick';

/*
 * A drawing on a page (```ink, `lib/ink.ts`): read, its strokes; in Bearbeiten drawn on where it
 * stands – the pen and the mouse draw, a finger scrolls the page (as the Pencil on a slide). Pen,
 * marker, eraser and the colours above it; a stroke is one step back (⌘Z) and one line in the
 * file. Drawn near its foot it grows; its grip below makes it taller or shorter.
 */

type Tool = InkTool | 'eraser';

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Stift' },
  { tool: 'marker', icon: 'marker', label: 'Marker' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer' },
];
const COLORS: AccentColor[] = ['red', 'blue', 'green', 'violet', 'yellow'];
const WIDTH: Record<InkTool, number> = { pen: 4, marker: 22 };
/** Room the eraser wipes around the pointer, in the drawing's units. */
const ERASER = 10;
/** Points closer than this (units) to the last are left out – smooth lines, short files. */
const STEP = 1.5;

const colorOf = (color: InkColor) => (color === 'text' ? 'var(--color-fg)' : accentColor(color));

/** The pen last picked – the next drawing starts with it. */
const lastPen: { tool: Tool; pen: InkColor; marker: InkColor } = {
  tool: 'pen',
  pen: 'text',
  marker: 'yellow',
};
const remember = (change: Partial<typeof lastPen>) => Object.assign(lastPen, change);

function Strokes({
  strokes,
  hidden,
}: {
  strokes: readonly InkStroke[];
  hidden?: (at: number) => boolean;
}) {
  return strokes.map((stroke, at) =>
    hidden?.(at) ? null : (
      <path
        // biome-ignore lint/suspicious/noArrayIndexKey: strokes are lines of the file, in order.
        key={at}
        d={inkPath(stroke.points)}
        fill="none"
        stroke={colorOf(stroke.color)}
        strokeWidth={stroke.width}
        strokeOpacity={stroke.tool === 'marker' ? 0.4 : 1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  );
}

export function InkBlock({ text, nodeKey }: { text: string; nodeKey: NodeKey }) {
  const { editable, picked, pick, editor } = useBlockPick(nodeKey);
  const ink = useMemo(() => parseInk(text), [text]);
  const strokes = useMemo(() => ink.strokes.map((each) => each.stroke), [ink]);
  const [tool, setToolState] = useState<Tool>(lastPen.tool);
  const [colors, setColors] = useState({ pen: lastPen.pen, marker: lastPen.marker });
  const [live, setLive] = useState<InkStroke | null>(null);
  const [wiped, setWiped] = useState<ReadonlySet<number> | null>(null);
  const [tall, setTall] = useState<number | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const drawing = useRef<{ id: number; stroke: InkStroke } | null>(null);
  const wiping = useRef<{ id: number; lines: Set<number> } | null>(null);
  const height = tall ?? ink.height;

  const setTool = (next: Tool) => {
    setToolState(next);
    remember({ tool: next });
  };
  const pen: InkTool = tool === 'marker' ? 'marker' : 'pen';
  const color = colors[pen];
  const setColor = (next: InkColor) => {
    setColors((now) => ({ ...now, [pen]: next }));
    remember({ [pen]: next });
    if (tool === 'eraser') setTool('pen');
  };

  // The Pencil draws, a finger scrolls: a stylus's touch is kept from scrolling the page (iPad's
  // Safari would take a pen's stroke down the page as a scroll and cancel it).
  useEffect(() => {
    const element = surface.current;
    if (!editable || !element) return;
    const hold = (event: TouchEvent) => {
      const touch = event.touches[0] as (Touch & { touchType?: string }) | undefined;
      if (touch?.touchType === 'stylus') event.preventDefault();
    };
    element.addEventListener('touchstart', hold, { passive: false });
    element.addEventListener('touchmove', hold, { passive: false });
    return () => {
      element.removeEventListener('touchstart', hold);
      element.removeEventListener('touchmove', hold);
    };
  }, [editable]);

  /** The pointer in the drawing's units. */
  const pointOf = (event: { clientX: number; clientY: number }): InkPoint | null => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const unit = INK_WIDTH / box.width;
    return [(event.clientX - box.left) * unit, (event.clientY - box.top) * unit];
  };

  /** Writes the block anew – one step back in the page's history. */
  const write = (change: (text: string) => string) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isRawBlockNode(node)) node.setText(change(node.getText()));
    });
  };

  const wipe = (point: InkPoint, lines: Set<number>) => {
    ink.strokes.forEach(({ line, stroke }, at) => {
      if (!lines.has(line) && touches(stroke, point, ERASER)) {
        lines.add(line);
        setWiped((now) => new Set(now).add(at));
      }
    });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // A finger scrolls; only the main button draws.
    if (!editable || event.pointerType === 'touch' || event.button !== 0) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // The Pencil's other end, or a pen's eraser button, wipes.
    if (tool === 'eraser' || (event.buttons & 32) !== 0) {
      wiping.current = { id: event.pointerId, lines: new Set() };
      setWiped(new Set());
      wipe(point, wiping.current.lines);
      return;
    }
    const stroke: InkStroke = { tool: pen, color, width: WIDTH[pen], points: [point] };
    drawing.current = { id: event.pointerId, stroke };
    setLive(stroke);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const wipeNow = wiping.current;
    if (wipeNow?.id === event.pointerId) {
      const point = pointOf(event);
      if (point) wipe(point, wipeNow.lines);
      return;
    }
    const now = drawing.current;
    if (now?.id !== event.pointerId) return;
    // A pen reports more often than frames come: every point it gave.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    let { points } = now.stroke;
    for (const each of events.length > 0 ? events : [event.nativeEvent]) {
      const point = pointOf(each);
      const last = points.at(-1);
      if (!point || (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < STEP)) continue;
      points = [...points, point];
    }
    if (points === now.stroke.points) return;
    now.stroke = { ...now.stroke, points };
    setLive(now.stroke);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const wipeNow = wiping.current;
    if (wipeNow?.id === event.pointerId) {
      wiping.current = null;
      setWiped(null);
      if (wipeNow.lines.size > 0) write((now) => removeLines(now, wipeNow.lines));
      return;
    }
    const now = drawing.current;
    if (now?.id !== event.pointerId) return;
    drawing.current = null;
    setLive(null);
    const lowest = Math.max(...now.stroke.points.map(([, y]) => y));
    // Written near its foot: room below for the next line.
    const grow = lowest > ink.height - INK_GROW / 3;
    write((text) => {
      const drawn = addStrokes(text, [now.stroke]);
      return grow ? setHeight(drawn, Math.max(ink.height, lowest) + INK_GROW) : drawn;
    });
  };

  const onPointerCancel = (event: PointerEvent<SVGSVGElement>) => {
    if (drawing.current?.id === event.pointerId) {
      drawing.current = null;
      setLive(null);
    }
    if (wiping.current?.id === event.pointerId) {
      wiping.current = null;
      setWiped(null);
    }
  };

  // The grip below: dragged, the drawing is as tall as it is pulled (not shorter than its ink).
  const grip = useRef<{ id: number; y: number; from: number } | null>(null);
  const lowestInk = useMemo(
    () =>
      Math.max(0, ...strokes.flatMap((stroke) => stroke.points.map(([, y]) => y + stroke.width))),
    [strokes],
  );
  const onGripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    grip.current = { id: event.pointerId, y: event.clientY, from: ink.height };
  };
  const onGripMove = (event: PointerEvent<HTMLDivElement>) => {
    const now = grip.current;
    const box = surface.current?.getBoundingClientRect();
    if (now?.id !== event.pointerId || !box) return;
    const unit = INK_WIDTH / box.width;
    setTall(Math.max(lowestInk + 20, 120, now.from + (event.clientY - now.y) * unit));
  };
  const onGripUp = (event: PointerEvent<HTMLDivElement>) => {
    if (grip.current?.id !== event.pointerId) return;
    grip.current = null;
    const next = tall;
    setTall(null);
    if (next !== null && Math.round(next) !== ink.height) write((now) => setHeight(now, next));
  };

  const hidden = wiped ? (at: number) => wiped.has(at) : undefined;
  // Read, as tall as its ink (the room left to write in is Bearbeiten's).
  const shown = editable ? height : Math.min(height, lowestInk + 16);
  const drawn = (
    <svg
      ref={surface}
      viewBox={`0 0 ${INK_WIDTH} ${Math.round(shown)}`}
      className={cn('page-ink-surface', editable && `page-ink-${tool}`)}
      role="img"
      aria-label={strokes.length > 0 ? 'Zeichnung' : 'Leere Zeichnung'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <Strokes strokes={strokes} hidden={hidden} />
      {live && <Strokes strokes={[live]} />}
    </svg>
  );

  if (!editable) return strokes.length > 0 ? <div className="page-ink">{drawn}</div> : null;

  return (
    <div
      className={cn('page-ink page-ink-editing', picked && 'page-picked')}
      contentEditable={false}
    >
      <div className="page-ink-bar">
        <Toolbar label="Zeichnen">
          {TOOLS.map((option) => (
            <IconButton
              key={option.tool}
              size="sm"
              icon={option.icon}
              label={option.label}
              active={tool === option.tool}
              onClick={() => setTool(option.tool)}
            />
          ))}
          <ToolbarDivider />
          <button
            type="button"
            aria-label="Farbe Text"
            title="Farbe Text"
            aria-pressed={color === 'text'}
            onClick={() => setColor('text')}
            className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-hover"
          >
            <span
              className={cn(
                'size-4 rounded-full bg-fg inset-ring inset-ring-surface-4',
                color === 'text' && 'ring-2 ring-fg ring-offset-2 ring-offset-placeholder',
              )}
            />
          </button>
          <ColorSwatches
            variant="dot"
            label="Farben"
            colors={COLORS}
            value={color === 'text' ? null : color}
            swatchLabel={(swatch) => `Farbe ${ACCENT_COLOR_NAMES[swatch]}`}
            onChange={setColor}
            className="gap-1"
          />
        </Toolbar>
        {/* A press beside the tools picks the drawing whole – ⌫ deletes it, as a picture. */}
        <button
          type="button"
          className="page-ink-pick"
          aria-label="Zeichnung auswählen"
          onClick={pick}
        />
      </div>
      {drawn}
      <div
        className="page-ink-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Höhe der Zeichnung"
        title="Ziehen: höher oder niedriger"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={() => {
          grip.current = null;
          setTall(null);
        }}
      />
    </div>
  );
}
