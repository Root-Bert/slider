import type {
  LineHeads,
  EditableElement,
  ElementLook,
  ElementStroke,
  LiveElement,
  LiveParagraph,
  LiveTextStyle,
  SlideOperation,
  StrokeDash,
  VerticalAlign,
} from '@slider/shared';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, IconButton, NumberField, ScrubHandle, useScrub, type IconName } from '@/ui';
import { ColorField } from './colors/ColorPalette';
import { EffectControls } from './fills/EffectControls';
import { useEditing } from './editing-context';
import { FontField } from './FontField';
import { useTryList } from './TryList';
import { TextAlignGrid, type Across } from './TextAlignGrid';
import { isFilled } from './live/css';
import { editorFonts } from './live/fonts';
import {
  commonLineSpacing,
  commonList,
  commonOf,
  commonValue,
  DEFAULT_STYLE,
  formatRange,
  maxCornerRadius,
  NEW_BOX,
  paragraphRange,
  richFromLive,
  type ParagraphPatch,
  type TextStylePatch,
} from './live/model';

/*
 * The formatting in the floating panel beside the picked element, one part per tab: the text –
 * font, size, colour, bold, italic, underline, strike, alignment, lists, line spacing and
 * capitals –, the border and the fill. While one
 * types on the slide the text's formats the selection (a caret: its word), else the whole
 * element. Buttons keep the focus in the text; fields take it and give it back.
 */

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];

const nextSize = (size: number, step: 1 | -1) =>
  step > 0
    ? (SIZES.find((value) => value > size + 0.01) ?? size + 8)
    : ([...SIZES].reverse().find((value) => value < size - 0.01) ?? Math.max(1, size - 1));

type Caps = NonNullable<LiveTextStyle['caps']>;

/** Each written as it shows. */
const CAPS: { value: Caps; label: string; shown: string }[] = [
  { value: 'none', label: 'Wie getippt', shown: 'Aa' },
  { value: 'uppercase', label: 'GROSSBUCHSTABEN', shown: 'AA' },
  { value: 'lowercase', label: 'kleinbuchstaben', shown: 'aa' },
  { value: 'capitalize', label: 'Wortanfänge Groß', shown: 'Ab' },
];

const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

/** The capitals every run (and empty line) has, else `null`. */
function capsOf(paragraphs: readonly LiveParagraph[]): Caps | null {
  const values = paragraphs.flatMap((paragraph) =>
    paragraph.runs.some((run) => run.text)
      ? paragraph.runs.map((run) => run.caps ?? 'none')
      : [paragraph.mark.caps ?? 'none'],
  );
  const first = values[0] ?? 'none';
  return values.every((value) => value === first) ? first : null;
}

const decimal = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 1 });

export const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** A row of the panel: a short label, its controls on the right. */
export function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-auto text-xs text-fg-subtle">{label}</span>
      {children}
    </div>
  );
}

/**
 * The text tab of a text typed on the slide: font, size, colour, B/I/U, where it sits in its box
 * (the 3 × 3 grid), lists, line spacing and capitals.
 */
export function TextControls({ element, live }: { element: EditableElement; live: LiveElement }) {
  return (
    <div className="flex flex-col gap-2">
      <TextFormat element={element} live={live} />
      <LetterEffects element={element} />
    </div>
  );
}

/**
 * The text's shadow – LibreOffice casts the box's shadow from its letters while the box has no
 * fill; a filled box casts it itself (its „Hintergrund“ tab).
 */
function LetterEffects({ element }: { element: EditableElement }) {
  const look = element.look;
  if (!look) return null;
  if (isFilled(look))
    return <p className="text-xs text-fg-subtle">Schatten der Schrift: nur ohne Hintergrund.</p>;
  return <EffectControls key={`letters:${element.id}`} element={element} only={['shadow']} />;
}

function TextFormat({ element, live }: { element: EditableElement; live: LiveElement }) {
  const editing = useEditing();
  const typing = editing.textEditing === element.id ? editing.textEditor : null;
  const value = <K extends keyof LiveTextStyle>(key: K): LiveTextStyle[K] | null =>
    typing ? typing.style[key] : commonValue(live.paragraphs, key);
  const font = value('font');
  const size = value('size');
  const color = value('color') ?? DEFAULT_STYLE.color;
  const align = typing ? typing.align : commonOf(live.paragraphs, (paragraph) => paragraph.align);
  const list = typing ? typing.list : commonList(live.paragraphs);
  const lineSpacing = typing ? typing.lineSpacing : commonLineSpacing(live.paragraphs);
  // Plain text has no capitals set: that reads as „none“.
  const caps = typing ? (typing.style.caps ?? 'none') : capsOf(live.paragraphs);

  const format = (patch: TextStylePatch, coalesce?: string) => {
    if (typing) {
      typing.format(patch);
      return;
    }
    void editing.apply(
      [
        {
          type: 'setRichText',
          elementId: element.id,
          paragraphs: richFromLive(formatRange(live.paragraphs, null, patch)),
        },
      ],
      { coalesce: coalesce && `${coalesce}:${element.id}` },
    );
  };
  const shape = (patch: ParagraphPatch) => {
    if (typing) {
      typing.paragraphs(patch);
      return;
    }
    void editing.apply([
      {
        type: 'setRichText',
        elementId: element.id,
        paragraphs: richFromLive(paragraphRange(live.paragraphs, null, patch)),
      },
    ]);
  };
  /** The text before formats were tried on it while not typed in (`tryStyle`), while they are. */
  const tried = useRef<LiveParagraph[] | null>(null);
  const textOf = (paragraphs: LiveParagraph[]): SlideOperation[] => [
    { type: 'setRichText', elementId: element.id, paragraphs: richFromLive(paragraphs) },
  ];
  // A font or size hovered in its list: typed in, the text editor shows it; else the element is
  // shown so – sent only once one is picked, the pick one ⌘Z step.
  const tryStyle = (patch: TextStylePatch | null) => {
    if (typing) {
      typing.tryFormat(patch);
      return;
    }
    if (!patch) {
      tried.current = null;
      editing.tryOut(null);
      return;
    }
    tried.current ??= live.paragraphs;
    editing.tryOut(textOf(formatRange(tried.current, null, patch)));
  };
  const pickStyle = (patch: TextStylePatch) => {
    if (typing) {
      typing.format(patch);
      return;
    }
    const before = tried.current ?? live.paragraphs;
    tried.current = null;
    editing.tryOut(null);
    void editing.apply(textOf(formatRange(before, null, patch)));
  };
  const toggle = (key: 'bold' | 'italic' | 'underline' | 'strike') =>
    format({ [key]: !value(key) });
  // Again on the list the lines are in: out of it.
  const listTo = (kind: 'bullet' | 'number') => shape({ list: list === kind ? null : kind });
  const listed = list === 'bullet' || list === 'number';
  // A cell of the grid: the lines' alignment and the box's at once – one step (typed in: the
  // lines as the typing formats them, the box beside).
  const place = (across: Across, down: VerticalAlign) => {
    // Justified lines sit in the left column: picking a row there keeps them justified.
    const sameAcross = align === across || (align === 'justify' && across === 'left');
    const box: SlideOperation[] =
      down === live.verticalAlign
        ? []
        : [{ type: 'setShapeStyle', elementId: element.id, verticalAlign: down }];
    if (typing) {
      if (!sameAcross) typing.paragraphs({ align: across });
      if (box.length) void editing.apply(box);
      return;
    }
    const lines: SlideOperation[] = sameAcross
      ? []
      : [
          {
            type: 'setRichText',
            elementId: element.id,
            paragraphs: richFromLive(paragraphRange(live.paragraphs, null, { align: across })),
          },
        ];
    if (lines.length || box.length) void editing.apply([...lines, ...box]);
  };
  const justified = align === 'justify';
  const offered = editorFonts();
  const fonts = font && !offered.includes(font) ? [font, ...offered] : offered;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <FontField
          value={font}
          fonts={fonts}
          onTry={(next) => tryStyle(next === null ? null : { font: next })}
          onPick={(next) => pickStyle({ font: next })}
          onDone={typing?.focus}
        />
        <SizeField
          size={size}
          onChange={(next) => format({ size: next })}
          onTry={(next) => tryStyle(next === null ? null : { size: next })}
          onPick={(next) => pickStyle({ size: next })}
          onDone={typing?.focus}
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1">
            <IconButton
              icon="formatBold"
              label="Fett (⌘B)"
              size="compact"
              active={value('bold') === true}
              onClick={() => toggle('bold')}
            />
            <IconButton
              icon="formatItalic"
              label="Kursiv (⌘I)"
              size="compact"
              active={value('italic') === true}
              onClick={() => toggle('italic')}
            />
            <IconButton
              icon="formatUnderlined"
              label="Unterstrichen (⌘U)"
              size="compact"
              active={value('underline') === true}
              onClick={() => toggle('underline')}
            />
            <IconButton
              icon="formatStrikethrough"
              label="Durchgestrichen (⌘⇧X)"
              size="compact"
              active={value('strike') === true}
              onClick={() => toggle('strike')}
            />
            <Divider />
            <IconButton
              icon="formatAlignJustify"
              label="Blocksatz"
              size="compact"
              active={justified}
              // Again: back to the left, where justified lines end.
              onClick={() => shape({ align: justified ? 'left' : 'justify' })}
            />
            <span className="ml-auto" />
            <ColorField
              label="Textfarbe"
              size="md"
              value={color}
              onChange={(next) => format({ color: next }, 'color')}
              opacity={value('opacity') ?? 1}
              onOpacity={(next) => format({ opacity: next < 1 ? next : undefined }, 'opacity')}
            />
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              icon="formatListBulleted"
              label="Aufzählung (⌘⇧8)"
              size="compact"
              active={list === 'bullet'}
              onClick={() => listTo('bullet')}
            />
            <IconButton
              icon="formatListNumbered"
              label="Nummerierung (⌘⇧7)"
              size="compact"
              active={list === 'number'}
              onClick={() => listTo('number')}
            />
            <IconButton
              icon="formatIndentDecrease"
              label="Ebene höher (⇧⇥)"
              size="compact"
              disabled={!listed}
              onClick={() => shape({ levelBy: -1 })}
            />
            <IconButton
              icon="formatIndentIncrease"
              label="Ebene tiefer (⇥)"
              size="compact"
              disabled={!listed}
              onClick={() => shape({ levelBy: 1 })}
            />
            <span className="ml-auto" />
            <PickField
              label="Zeilenabstand"
              shown={
                <>
                  <Icon name="formatLineSpacing" size={16} />
                  {lineSpacing === null ? '–' : decimal(lineSpacing)}
                </>
              }
              value={lineSpacing === null ? '' : String(lineSpacing)}
              options={[
                ...(lineSpacing !== null && !LINE_SPACINGS.includes(lineSpacing)
                  ? [lineSpacing]
                  : []),
                ...LINE_SPACINGS,
              ].map((item) => ({ value: String(item), label: decimal(item) }))}
              onChange={(next) => shape({ lineSpacing: Number(next) })}
            />
            <PickField
              label="Groß- und Kleinschreibung"
              shown={CAPS.find((item) => item.value === caps)?.shown ?? '–'}
              value={caps ?? ''}
              options={CAPS}
              onChange={(next) => format({ caps: next === 'none' ? undefined : (next as Caps) })}
            />
          </div>
        </div>
        <TextAlignGrid across={align} down={live.verticalAlign} onPick={place} />
      </div>
    </div>
  );
}

/**
 * A small field showing what is set, the system's list of the choices under it: compact where a
 * whole select would not fit the row.
 */
function PickField({
  label,
  shown,
  value,
  options,
  onChange,
}: {
  label: string;
  shown: ReactNode;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span
      title={label}
      className="field-well focus-field relative flex h-8 shrink-0 items-center gap-1 rounded-control-sm pr-0.5 pl-1.5 text-xs tabular-nums"
    >
      {shown}
      <Icon name="expandMore" size={14} className="text-fg-subtle" />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {value === '' && <option value="" disabled hidden />}
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A size as the field writes it. */
const sizeText = (size: number) => String(Number(size.toFixed(1)));

/**
 * The size in points: typed (↑ ↓, the wheel over it or its handle dragged step through the usual
 * sizes), or picked from them in the list the arrow opens – hovered or stepped through, the
 * text shows each at once, like the font beside it (`useTryList`).
 */
function SizeField({
  size,
  onChange,
  onTry,
  onPick,
  onDone,
}: {
  size: number | null;
  onChange: (size: number) => void;
  onTry: (size: number | null) => void;
  onPick: (size: number) => void;
  onDone?: () => void;
}) {
  const shown = size === null ? '' : sizeText(size);
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ size, onChange });
  useLayoutEffect(() => {
    latest.current = { size, onChange };
  });
  // A size of its own (13,5) in the list too, where it goes.
  const sizes =
    size === null || SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b);
  const { open, setOpen, toggleList, triggerProps, wrapperRef, onTriggerKey, panel } = useTryList({
    items: sizes,
    value: size,
    label: 'Schriftgröße',
    onTry,
    onPick,
    onDone,
    typed: (item, text) => sizeText(item).startsWith(text),
    render: (item) => <span className="text-sm tabular-nums">{sizeText(item)}</span>,
  });

  // The wheel over it and its handle dragged step through the usual sizes (⇧: several at once).
  const handleRef = useRef<HTMLSpanElement>(null);
  const { dragging } = useScrub(wrapperRef, handleRef, (direction, keys) => {
    const { size, onChange } = latest.current;
    if (size === null) return;
    setDraft(null);
    let next = size;
    for (let i = keys.shiftKey ? 3 : 1; i > 0; i--) next = nextSize(next, direction);
    latest.current = { size: next, onChange };
    onChange(next);
  });
  const commit = () => {
    const value = Number((draft ?? '').replace(',', '.'));
    setDraft(null);
    if (draft !== null && Number.isFinite(value) && value >= 1 && value <= 400) onChange(value);
  };
  return (
    <div
      ref={wrapperRef}
      className="field-well focus-field flex h-8 w-20 shrink-0 items-center rounded-control-sm"
    >
      <ScrubHandle ref={handleRef} label="Schriftgröße" dragging={dragging} />
      <input
        aria-label="Schriftgröße (pt)"
        title="Schriftgröße in pt, ↑ ↓, scrollen oder ziehen ändert sie"
        inputMode="decimal"
        value={draft ?? shown}
        placeholder="–"
        onChange={(event) => setDraft(event.target.value)}
        // Typed into while the list is open: the list goes, and what it tried on with it.
        onFocus={() => setOpen(false)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          } else if (event.key === 'ArrowDown' && event.altKey && !open) {
            event.preventDefault();
            toggleList();
          } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && size !== null) {
            event.preventDefault();
            setDraft(null);
            onChange(nextSize(size, event.key === 'ArrowUp' ? 1 : -1));
          }
        }}
        className="w-full min-w-0 bg-transparent text-sm tabular-nums outline-none"
      />
      <button
        type="button"
        {...triggerProps}
        aria-label="Schriftgröße wählen"
        title="Schriftgröße wählen"
        onClick={toggleList}
        onKeyDown={onTriggerKey}
        className="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center text-fg-subtle outline-none"
      >
        <Icon name="expandMore" size={16} />
      </button>
      {panel}
    </div>
  );
}

/** Applies a fill or border to the element. */
function useShapeStyle(elementId: string) {
  const editing = useEditing();
  return (
    change: { fill?: string | null; stroke?: ElementStroke | null; heads?: LineHeads },
    coalesce?: string,
  ) =>
    void editing.apply([{ type: 'setShapeStyle', elementId, ...change }], {
      coalesce: coalesce && `${coalesce}:${elementId}`,
    });
}

const DASHES: { value: StrokeDash | null; icon: IconName; label: string }[] = [
  { value: null, icon: 'borderClear', label: 'Kein Rahmen' },
  { value: 'solid', icon: 'lineSolid', label: 'Linie' },
  { value: 'dash', icon: 'lineDashed', label: 'Gestrichelt' },
  { value: 'dot', icon: 'lineDotted', label: 'Gepunktet' },
];

/**
 * The border, in the fill tab: none, a line, dashes or dots – its width and colour. A line's own
 * („Linie“): never none (it would be gone), its colour new when it had none.
 */
export function BorderControls({ element, look }: { element: EditableElement; look: ElementLook }) {
  const style = useShapeStyle(element.id);
  const stroke = look.stroke;
  const dash = stroke ? (stroke.dash ?? 'solid') : null;
  const line = !!element.line;
  return (
    <div className="flex flex-col gap-1.5">
      <Line label={line ? 'Linie' : 'Rahmen'}>
        {(line ? DASHES.filter((item) => item.value) : DASHES).map((item) => (
          <IconButton
            key={item.value ?? 'none'}
            icon={item.icon}
            label={item.label}
            size="compact"
            active={dash === item.value}
            onClick={() =>
              style({
                stroke: item.value ? { ...(stroke ?? NEW_BOX.stroke), dash: item.value } : null,
              })
            }
          />
        ))}
      </Line>
      {stroke && (
        <Line label="Stärke und Farbe">
          <StrokeWidthField
            width={stroke.width}
            onChange={(width) => style({ stroke: { ...stroke, width } }, 'stroke')}
          />
          <ColorField
            label={line ? 'Linienfarbe' : 'Rahmenfarbe'}
            value={stroke.color}
            onChange={(color) => style({ stroke: { ...stroke, color } }, 'stroke')}
          />
        </Line>
      )}
    </div>
  );
}

const HEADS: { value: LineHeads; icon: IconName; label: string }[] = [
  { value: 'none', icon: 'remove', label: 'Ohne Pfeilspitze' },
  { value: 'end', icon: 'arrowForward', label: 'Pfeilspitze am Ende' },
  { value: 'both', icon: 'arrowsBoth', label: 'Pfeilspitzen an beiden Enden' },
];

/**
 * A line's arrow heads: none, at its end, at both ends. One with a head at its start only (from
 * another file) shows as at its end – picked, its head goes there.
 */
export function HeadControls({ element, heads }: { element: EditableElement; heads: LineHeads }) {
  const style = useShapeStyle(element.id);
  const shown = heads === 'start' ? 'end' : heads;
  return (
    <Line label="Pfeilspitzen">
      {HEADS.map((item) => (
        <IconButton
          key={item.value}
          icon={item.icon}
          label={item.label}
          size="compact"
          active={shown === item.value}
          aria-pressed={shown === item.value}
          onClick={() => item.value !== heads && style({ heads: item.value })}
        />
      ))}
    </Line>
  );
}

/**
 * The line width in points. Shown to 0.05 pt: a 1 pt line from a file stored in cm (0.035 cm)
 * reads 0.99 pt.
 */
function StrokeWidthField({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  return (
    <NumberField
      label="Rahmenstärke"
      title="Rahmenstärke in pt"
      unit="pt"
      value={Math.round(width * 20) / 20}
      onChange={onChange}
      min={0}
      max={20}
      step={0.25}
      decimals={2}
    />
  );
}

/**
 * A rectangle's corners, in the fill tab: their radius in points, 0 sharp – one rectangle that is
 * rounded as far as one likes (as in Figma), no rounded rectangle of its own.
 */
export function CornerControls({ element, radius }: { element: EditableElement; radius: number }) {
  const editing = useEditing();
  // At most half the shorter side (round ends), as the file keeps it: no jump on the answer.
  const max = Math.floor(maxCornerRadius(element.bbox, editing.pageSize) * 10) / 10;
  return (
    <Line label="Eckenradius">
      <NumberField
        label="Eckenradius"
        title="Eckenradius in pt, 0 für spitze Ecken"
        unit="pt"
        value={Math.round(radius * 10) / 10}
        onChange={(next) =>
          void editing.apply(
            [
              {
                type: 'setCornerRadius',
                elementId: element.id,
                radius: Math.min(next, maxCornerRadius(element.bbox, editing.pageSize)),
              },
            ],
            { coalesce: `corners:${element.id}` },
          )
        }
        min={0}
        max={max}
        step={1}
        decimals={1}
      />
    </Line>
  );
}
