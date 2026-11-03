import {
  isNewLine,
  NEW_LINES,
  NEW_SHAPES,
  type ElementFlip,
  type FrameShape as Shape,
  type Rect,
} from '@slider/shared';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { isTextTarget } from '@/lib/dom';
import { typesCharacter } from '@/lib/keyboard';
import { Button, cn, GlassPanel, iconButtonClasses } from '@/ui';
import { focusShapes, frameShapes } from './frame-shapes';

export type InsertKind = 'text' | 'shape' | 'image';
/** What a frame drawn is for: picking the elements it encloses, or a new one in it. */
export type FrameKind = 'select' | InsertKind;

const KINDS: {
  kind: FrameKind;
  label: string;
  icon: 'highlightAlt' | 'textFields' | 'cropSquare' | 'image';
}[] = [
  { kind: 'select', label: 'Auswählen', icon: 'highlightAlt' },
  { kind: 'text', label: 'Text', icon: 'textFields' },
  { kind: 'shape', label: 'Form', icon: 'cropSquare' },
  { kind: 'image', label: 'Bild', icon: 'image' },
];

/**
 * The frame being drawn – caught at a line, it pulses once per catch (`caught`), as a moved
 * element does –, then filled (turned as drawn) – with what was typed into it meanwhile.
 */
export function FrameOutline({
  rect,
  rotation = 0,
  caught = null,
  text,
}: {
  rect: Rect;
  rotation?: number;
  caught?: string | null;
  text?: string;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-mark border-2 border-dashed border-(--edit-color) bg-(--edit-tint)"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }}
    >
      {caught && (
        <span
          key={caught}
          className="absolute inset-0 rounded-[inherit] snap-ring"
          style={{ ['--snap-color' as string]: 'var(--edit-color)' }}
        />
      )}
      {text && (
        <span className="block truncate px-2 py-1 text-body whitespace-pre text-fg">{text}</span>
      )}
    </div>
  );
}

/**
 * The shapes on offer, each drawn small (24 × 24) as LibreOffice will draw it. No rounded rectangle:
 * a rectangle's corners are rounded by its radius („Ecken“, `CornerControls`).
 */
const SHAPES: { shape: Shape; outline: ReactNode }[] = [
  { shape: 'rectangle', outline: <rect x="3" y="6" width="18" height="12" /> },
  { shape: 'ellipse', outline: <ellipse cx="12" cy="12" rx="9" ry="6.5" /> },
  { shape: 'isosceles-triangle', outline: <polygon points="12,4 21,20 3,20" /> },
  { shape: 'diamond', outline: <polygon points="12,3 21,12 12,21 3,12" /> },
  { shape: 'hexagon', outline: <polygon points="7.5,5 16.5,5 21,12 16.5,19 7.5,19 3,12" /> },
  { shape: 'right-arrow', outline: <polygon points="2,9 13,9 13,4 22,12 13,20 13,15 2,15" /> },
  { shape: 'star5', outline: <polygon points={starPoints()} /> },
  // Lines across the frame, from where it was begun to where it ended.
  { shape: 'line', outline: <line x1="4" y1="20" x2="20" y2="4" /> },
  {
    shape: 'arrow',
    outline: (
      <>
        <line x1="4" y1="20" x2="16.5" y2="7.5" />
        <polygon points="20,4 18.2,11.6 12.4,5.8" fill="currentColor" fillOpacity={1} />
      </>
    ),
  },
];

/** A shape's name, as the file names it. */
const shapeName = (shape: Shape) => (isNewLine(shape) ? NEW_LINES[shape] : NEW_SHAPES[shape]);

/**
 * The shapes on offer as buttons – in „Form“'s panel beside the frame (`FramePanelPreview`), where
 * one is taken at once.
 */
export function ShapeButtons({
  onPick,
  onShow,
  className,
}: {
  onPick: (shape: Shape) => void;
  /**
   * The shape the frame shows meanwhile: the one under the pointer, else the one Tab is on;
   * `null` when neither (the box).
   */
  onShow?: (shape: Shape | null) => void;
  className?: string;
}) {
  const [hovered, setHovered] = useState<Shape | null>(null);
  const [focused, setFocused] = useState<Shape | null>(null);
  const shown = hovered ?? focused;
  const show = useEffectEvent((shape: Shape | null) => onShow?.(shape));
  useEffect(() => show(shown), [shown]);
  useEffect(() => () => show(null), []);
  return SHAPES.map((item) => (
    <button
      key={item.shape}
      type="button"
      data-shape={item.shape}
      aria-label={shapeName(item.shape)}
      title={shapeName(item.shape)}
      className={cn(
        iconButtonClasses({ size: 'lg' }),
        'focus-visible:bg-selected focus-visible:text-fg focus-visible:outline-none',
        className,
      )}
      onClick={() => onPick(item.shape)}
      onFocus={() => setFocused(item.shape)}
      onBlur={() => setFocused((shape) => (shape === item.shape ? null : shape))}
      onPointerEnter={() => setHovered(item.shape)}
      onPointerLeave={() => setHovered((shape) => (shape === item.shape ? null : shape))}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width={22}
        height={22}
        fill="currentColor"
        fillOpacity={0.2}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      >
        {item.outline}
      </svg>
    </button>
  ));
}

/**
 * The shapes as LibreOffice draws them in their box (`EnhancedCustomShapeGeometry`), of a
 * 100 × 100 box; the rectangle is the box itself.
 */
const SHAPE_POINTS: Partial<Record<Shape, string>> = {
  'isosceles-triangle': '50,0 100,100 0,100',
  diamond: '50,0 100,50 50,100 0,50',
  hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
  'right-arrow': '0,25 75,25 75,0 100,50 75,100 75,75 0,75',
  star5: [
    [10797, 0],
    [13321, 8256],
    [21600, 8256],
    [14878, 13405],
    [17401, 21600],
    [10797, 16580],
    [4198, 21600],
    [6722, 13405],
    [0, 8256],
    [8278, 8256],
  ]
    .map(([x = 0, y = 0]) => `${(x / 216).toFixed(2)},${(y / 216).toFixed(2)}`)
    .join(' '),
};

/**
 * The drawn frame as the shape picked in „Form“'s panel would fill it – tinted, its line dashed as
 * the frame's –, stretched over the box it lies in; `null` for the rectangle (the box shows it).
 */
export function FrameShape({ shape, flip }: { shape: Shape; flip?: ElementFlip }) {
  if (shape !== 'ellipse' && !isNewLine(shape) && !SHAPE_POINTS[shape]) return null;
  const outline = {
    fill: 'var(--edit-tint)',
    stroke: 'var(--edit-color)',
    strokeWidth: 2,
    strokeDasharray: '6 4',
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  return (
    <svg
      aria-hidden
      data-frame-shape={shape}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {isNewLine(shape) ? (
        // From where the frame was begun to where it ended.
        <line
          x1={flip?.x ? 100 : 0}
          y1={flip?.y ? 100 : 0}
          x2={flip?.x ? 0 : 100}
          y2={flip?.y ? 0 : 100}
          {...outline}
        />
      ) : shape === 'ellipse' ? (
        <ellipse cx="50" cy="50" rx="50" ry="50" {...outline} />
      ) : (
        <polygon points={SHAPE_POINTS[shape]} {...outline} />
      )}
    </svg>
  );
}

function starPoints(): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 4 : 9.5;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(12 + r * Math.cos(angle)).toFixed(2)},${(12.5 + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

/**
 * What the frame is for – first, when it encloses elements, picking them together („Auswählen“,
 * picked as it opens then) –, else what goes into it: under it (above it near the slide's foot), like a picked element's
 * row of parts (`FormatBar`). One kind is picked – „Text“ as it opens –, Tab / ⇧Tab go round
 * wherever the focus is (only a field typed in elsewhere keeps its keys), the kind's panel shows
 * meanwhile (`FramePanelPreview`); a click, ↵ or Space takes it, Esc drops the frame. Typing goes
 * on in the picked kind: on „Text“ it writes the text, on „Bild“ it searches the photos (or
 * describes the picture to generate, without a photo service; with neither, only „Datei“ is left
 * – typing does nothing) – `onType`, for the kinds in `typed`. The row itself never changes: a
 * shape is picked in „Form“'s panel only – taking „Form“ moves the focus onto its shapes, Tab steps
 * them there, Esc goes back to „Form“.
 */
export function KindChooser({
  rect,
  kind: picked,
  typed,
  selectable = 0,
  onKind,
  onPick,
  onType,
  onCancel,
}: {
  rect: Rect;
  /** The kind picked (focused): its panel shows. */
  kind: FrameKind;
  /** The kinds typing on goes on with. */
  typed: readonly InsertKind[];
  /** How many elements the frame encloses: „Auswählen“ is offered for one or more. */
  selectable?: number;
  onKind: (kind: FrameKind) => void;
  onPick: (kind: FrameKind, shape?: Shape) => void;
  onType: (kind: InsertKind, text: string) => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const kinds = selectable > 0 ? KINDS : KINDS.filter((item) => item.kind !== 'select');
  const pickKind = (kind: FrameKind) => {
    if (kind === 'shape') focusShapes();
    else onPick(kind);
  };
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // The chooser's keys wherever the focus is – on its buttons, left on the slide or in the
    // preview's panel (`FramePanelPreview`) – but not in a field typed in elsewhere (a comment).
    const target = event.target instanceof HTMLElement ? event.target : null;
    const inside = !!target && !!panel.current?.contains(target);
    // On „Form“'s shapes in the panel: a button's keys are its own (↵, Space press it).
    const shapes = !!target && !!frameShapes()?.contains(target);
    if (!inside && (isTextTarget(target) || target?.closest('dialog'))) return;
    if (event.isComposing) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const take = () => {
      // Before the editor's and the viewer's own keys (Tab steps their tools, letters are tools).
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (event.key === 'Tab' && plain) {
      take();
      const step = event.shiftKey ? -1 : 1;
      if (shapes) {
        const stops = [...(frameShapes()?.querySelectorAll<HTMLElement>('[data-shape]') ?? [])];
        const at = target ? stops.indexOf(target) : -1;
        stops[(at + step + stops.length) % stops.length]?.focus({ preventScroll: true });
        return;
      }
      const at = kinds.findIndex((item) => item.kind === picked);
      const next = kinds[(at + step + kinds.length) % kinds.length]!.kind;
      onKind(next);
      panel.current
        ?.querySelector<HTMLElement>(`[data-kind="${next}"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    // ↵ on a focused button presses it; elsewhere it takes the picked kind.
    if (event.key === 'Enter' && plain && !inside && !shapes) {
      take();
      pickKind(picked);
      return;
    }
    // A letter (Space still presses a button): goes on in the picked kind.
    if (typesCharacter(event) && event.key !== ' ' && !shapes) {
      if (picked === 'select' || !typed.includes(picked)) return;
      take();
      onType(picked, event.key);
      return;
    }
    if (event.key !== 'Escape' || !plain) return;
    take();
    if (shapes)
      panel.current
        ?.querySelector<HTMLElement>('[data-kind="shape"]')
        ?.focus({ preventScroll: true });
    else onCancel();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener, { capture: true });
    return () => window.removeEventListener('keydown', listener, { capture: true });
  }, []);
  // As it opens: the picked kind (not again when the kind changes: that is the focus moving).
  useEffect(() => {
    panel.current
      ?.querySelector<HTMLElement>(`[data-kind="${picked}"]`)
      ?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const below = rect.y + rect.h < 0.8;
  return (
    <GlassPanel
      ref={panel}
      tone="elevated"
      role="toolbar"
      aria-label="Rahmen füllen mit"
      data-frame-chooser=""
      tabIndex={-1}
      className="absolute z-1 flex -translate-x-1/2 items-center gap-1 p-1 outline-none"
      style={{
        left: `${(rect.x + rect.w / 2) * 100}%`,
        top: below ? `calc(${(rect.y + rect.h) * 100}% + 8px)` : undefined,
        bottom: below ? undefined : `calc(${(1 - rect.y) * 100}% + 8px)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {kinds.map((item) => (
        <Button
          key={item.kind}
          size="sm"
          variant="ghost"
          icon={item.icon}
          data-kind={item.kind}
          title={
            item.kind === 'select'
              ? selectable === 1
                ? 'Das Element im Rahmen auswählen'
                : `Die ${selectable} Elemente im Rahmen auswählen`
              : undefined
          }
          aria-pressed={item.kind === picked}
          className="focus-visible:outline-none aria-pressed:bg-selected aria-pressed:text-fg"
          onFocus={() => onKind(item.kind)}
          onClick={() => pickKind(item.kind)}
        >
          {item.label}
        </Button>
      ))}
    </GlassPanel>
  );
}
