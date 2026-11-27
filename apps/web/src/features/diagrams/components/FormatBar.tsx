import {
  DIAGRAM_SHAPES,
  DIAGRAM_TINTS,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type DiagramShape,
  type DiagramTint,
} from '@slider/shared';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useCallback, useState, type ReactNode } from 'react';
import { isApplePlatform } from '@/lib/platform';
import {
  cn,
  ColorMixer,
  Icon,
  IconButton,
  PopoverPanel,
  Toolbar,
  ToolbarDivider,
  usePopover,
  type IconName,
} from '@/ui';
import { absoluteOf, arrowEnds, type Rect } from '../lib/flow';
import { rectIn, updateArrows, updateBoxes } from '../lib/edit';
import { SHAPE_LABEL, tintSwatch } from '../lib/labels';
import { ShapeIcon } from './ShapeOutline';


const TINT_LABEL: Record<DiagramTint, string> = {
  gray: 'Grau',
  blue: 'Blau',
  cyan: 'Cyan',
  green: 'Grün',
  yellow: 'Gelb',
  red: 'Rot',
  violet: 'Violett',
};


const OUTLINES = DIAGRAM_SHAPES.filter((shape) => shape !== 'frame' && shape !== 'text');

interface Props {
  diagram: Diagram;
  selected: ReadonlySet<string>;
  /** A change; `live`: one of many while a colour is mixed (one step once it is let go). */
  onChange: (next: Diagram, live?: boolean) => void;
  onEnd: () => void;
  onDelete: () => void;
  onFrame: () => void;
}

/** One of a row of choices, pressed when it is the one. */
function Choice({
  icon,
  label,
  active,
  onClick,
  children,
}: {
  icon?: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  if (icon) {
    return <IconButton icon={icon} label={label} size="sm" active={active} onClick={onClick} />;
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-control px-1.5 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg',
        active && 'bg-selected text-fg',
      )}
    >
      {children}
    </button>
  );
}

function ShapePicker({ value, onPick }: { value: DiagramShape | null; onPick: (shape: DiagramShape) => void }) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({ hasPopup: true });
  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        aria-label={`Form: ${value ? SHAPE_LABEL[value] : 'gemischt'}`}
        title="Form"
        className="flex h-7 items-center gap-0.5 rounded-control pr-0.5 pl-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <ShapeIcon shape={value ?? 'rounded'} />
        <Icon name="expandMore" size={14} />
      </button>
      {open && (
        <PopoverPanel ref={panelRef} id={panelId} padding="sm" aria-label="Form" className="grid w-max grid-cols-5 gap-0.5">
          {OUTLINES.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-label={SHAPE_LABEL[shape]}
              title={SHAPE_LABEL[shape]}
              aria-pressed={shape === value}
              onClick={() => {
                onPick(shape);
                close();
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-hover hover:text-fg',
                shape === value && 'bg-selected text-fg',
              )}
            >
              <ShapeIcon shape={shape} />
            </button>
          ))}
        </PopoverPanel>
      )}
    </div>
  );
}

function ColorPicker({
  value,
  onPick,
  onMix,
  onEnd,
}: {
  value: string | undefined | null;
  onPick: (color: string | undefined) => void;
  onMix: (color: string) => void;
  onEnd: () => void;
}) {
  const { open, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
    onOpenChange: (isOpen) => {
      if (!isOpen) onEnd();
    },
  });
  const own = value?.startsWith('#') ? value : null;
  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        aria-label="Farbe"
        title="Farbe"
        className="flex size-7 items-center justify-center rounded-control transition-colors hover:bg-hover"
      >
        <span
          className="size-4 rounded-full inset-ring inset-ring-surface-4"
          style={{ backgroundColor: value === null ? 'transparent' : tintSwatch(value) }}
        />
      </button>
      {open && (
        <PopoverPanel ref={panelRef} id={panelId} padding="lg" aria-label="Farbe" className="flex w-60 flex-col gap-3">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs text-fg-subtle">Farben</h3>
            <div className="-m-0.5 flex flex-wrap gap-2 p-0.5">
              {DIAGRAM_TINTS.map((tint) => {
                const picked = (value ?? 'gray') === tint || (tint === 'gray' && value === undefined);
                return (
                  <button
                    key={tint}
                    type="button"
                    aria-label={TINT_LABEL[tint]}
                    title={TINT_LABEL[tint]}
                    aria-pressed={picked}
                    onClick={() => onPick(tint === 'gray' ? undefined : tint)}
                    className={cn(
                      'size-6 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110',
                      picked && 'ring-2 ring-fg ring-offset-1 ring-offset-glass-solid',
                    )}
                    style={{ backgroundColor: tintSwatch(tint) }}
                  />
                );
              })}
            </div>
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs text-fg-subtle">Eigene</h3>
            <ColorMixer value={own} onChange={(color) => onMix(color.slice(0, 7))} />
          </section>
        </PopoverPanel>
      )}
    </div>
  );
}

/** The same value on all, or `null` where they differ. */
function common<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0]!;
  return values.every((value) => value === first) ? first : null;
}

/**
 * Over what is picked, as in Figma: its shape, colour, text size – or for arrows their line,
 * route and ends. Nothing opens over the page beyond its own small menus.
 */
export function FormatBar({ diagram, selected, onChange, onEnd, onDelete, onFrame }: Props) {
  const flow = useReactFlow();
  useViewport(); // Drawn again as the canvas moves: it stays over what it belongs to.
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Its own size, to stand centred over what it belongs to and inside the window.
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const boxes = diagram.nodes.filter((box) => selected.has(box.id));
  const arrows = diagram.edges.filter((arrow) => selected.has(arrow.id));
  if (boxes.length === 0 && arrows.length === 0) return null;
  const outlined = boxes.filter((box) => box.shape !== 'frame');
  const shapes = outlined.filter((box) => box.shape !== 'text');
  const boxIds = new Set(boxes.map((box) => box.id));
  const arrowIds = new Set(arrows.map((arrow) => arrow.id));

  // Where it stands: over the picked boxes and arrows, on the screen.
  const rects: Rect[] = boxes.map((box) => rectIn(diagram, box));
  for (const arrow of arrows) {
    const from = absoluteOf(diagram, arrow.from);
    const to = absoluteOf(diagram, arrow.to);
    if (!from || !to) continue;
    const ends = arrowEnds(from, to, arrow);
    rects.push({
      x: Math.min(ends.sourceX, ends.targetX),
      y: Math.min(ends.sourceY, ends.targetY),
      width: Math.abs(ends.sourceX - ends.targetX),
      height: Math.abs(ends.sourceY - ends.targetY),
    });
  }
  if (rects.length === 0) return null;
  const top = flow.flowToScreenPosition({
    x: (Math.min(...rects.map((r) => r.x)) + Math.max(...rects.map((r) => r.x + r.width))) / 2,
    y: Math.min(...rects.map((r) => r.y)),
  });
  const bottom = flow.flowToScreenPosition({ x: 0, y: Math.max(...rects.map((r) => r.y + r.height)) });
  // Clear of the ports around a picked box (22 px out, 9 px round).
  const gap = 40;
  const above = top.y - size.height - gap;
  const y = above > 64 ? above : Math.min(bottom.y + gap, window.innerHeight - size.height - 88);
  const x = Math.max(8, Math.min(top.x - size.width / 2, window.innerWidth - size.width - 8));

  const setBoxes = (change: (box: DiagramNode) => DiagramNode, live = false) =>
    onChange(updateBoxes(diagram, boxIds, change), live);
  const setArrows = (change: (arrow: DiagramEdge) => DiagramEdge) =>
    onChange(updateArrows(diagram, arrowIds, change));
  const setColor = (color: string | undefined, live = false) => {
    let next = updateBoxes(diagram, boxIds, (box) => withColor(box, color));
    next = updateArrows(next, arrowIds, (arrow) => withColor(arrow, color));
    onChange(next, live);
  };
  const color = common([...boxes.map((box) => box.color), ...arrows.map((arrow) => arrow.color)]);
  const sizeNow = common(outlined.map((box) => box.size ?? 'm'));
  const line = common(arrows.map((arrow) => arrow.line ?? 'solid'));
  const route = common(arrows.map((arrow) => arrow.route ?? 'elbow'));
  const start = common(arrows.map((arrow) => arrow.start ?? 'none'));
  const end = common(arrows.map((arrow) => arrow.end ?? 'arrow'));
  const mod = isApplePlatform() ? '⌥⌘G' : 'Strg Alt G';

  return (
    <div
      ref={ref}
      data-format-bar
      className="fixed z-(--z-raised)"
      style={{ left: x, top: y, visibility: size.width ? 'visible' : 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Toolbar label="Format">
        {shapes.length > 0 && (
          <ShapePicker
            value={common(shapes.map((box) => box.shape))}
            onPick={(shape) => setBoxes((box) => (box.shape === 'text' ? box : { ...box, shape }))}
          />
        )}
        <ColorPicker
          value={color === null && (boxes.length + arrows.length > 1) ? null : (color ?? undefined)}
          onPick={(next) => setColor(next)}
          onMix={(next) => setColor(next, true)}
          onEnd={onEnd}
        />
        {outlined.length > 0 && (
          <>
            <ToolbarDivider />
            {(['s', 'm', 'l'] as const).map((each) => (
              <Choice
                key={each}
                label={{ s: 'Kleine Schrift', m: 'Normale Schrift', l: 'Große Schrift' }[each]}
                active={sizeNow === each}
                onClick={() =>
                  setBoxes((box) => {
                    const { size: _size, ...rest } = box;
                    return each === 'm' ? rest : { ...rest, size: each };
                  })
                }
              >
                <span className={each === 's' ? 'text-xs' : each === 'l' ? 'text-base font-semibold' : ''}>A</span>
              </Choice>
            ))}
          </>
        )}
        {arrows.length > 0 && (
          <>
            <ToolbarDivider />
            {(['solid', 'dashed', 'dotted'] as const).map((each) => (
              <Choice
                key={each}
                icon={each === 'solid' ? 'lineSolid' : each === 'dashed' ? 'lineDashed' : 'lineDotted'}
                label={{ solid: 'Durchgezogen', dashed: 'Gestrichelt', dotted: 'Gepunktet' }[each]}
                active={line === each}
                onClick={() =>
                  setArrows((arrow) => {
                    const { line: _line, ...rest } = arrow;
                    return each === 'solid' ? rest : { ...rest, line: each };
                  })
                }
              />
            ))}
            <ToolbarDivider />
            {(['elbow', 'curve', 'straight'] as const).map((each) => (
              <Choice
                key={each}
                label={{ elbow: 'Eckig', curve: 'Gebogen', straight: 'Gerade' }[each]}
                active={route === each}
                onClick={() =>
                  setArrows((arrow) => {
                    const { route: _route, ...rest } = arrow;
                    return each === 'elbow' ? rest : { ...rest, route: each };
                  })
                }
              >
                <RouteIcon route={each} />
              </Choice>
            ))}
            <ToolbarDivider />
            <Choice
              icon="arrowBack"
              label="Spitze am Anfang"
              active={start === 'arrow'}
              onClick={() =>
                setArrows((arrow) => {
                  const { start: _start, ...rest } = arrow;
                  return start === 'arrow' ? rest : { ...rest, start: 'arrow' };
                })
              }
            />
            <Choice
              icon="arrowForward"
              label="Spitze am Ende"
              active={end === 'arrow'}
              onClick={() =>
                setArrows((arrow) => {
                  const { end: _end, ...rest } = arrow;
                  return end === 'arrow' ? { ...rest, end: 'none' } : rest;
                })
              }
            />
          </>
        )}
        <ToolbarDivider />
        {boxes.length > 0 && (
          <IconButton icon="group" label="In Rahmen setzen" title={`In Rahmen setzen (${mod})`} size="sm" onClick={onFrame} />
        )}
        <IconButton icon="delete" label="Löschen" title="Löschen (Entf)" size="sm" onClick={onDelete} />
      </Toolbar>
    </div>
  );
}

function withColor<T extends { color?: string }>(item: T, color: string | undefined): T {
  const { color: _color, ...rest } = item;
  return (color ? { ...rest, color } : rest) as T;
}

function RouteIcon({ route }: { route: 'elbow' | 'curve' | 'straight' }) {
  const d =
    route === 'elbow' ? 'M3 15 H10 V5 H17' : route === 'curve' ? 'M3 15 C10 15 10 5 17 5' : 'M3 15 L17 5';
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
