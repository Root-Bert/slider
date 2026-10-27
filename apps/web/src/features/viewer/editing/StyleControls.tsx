import type {
  EditableElement,
  LiveElement,
  LiveTextStyle,
  TextAlign,
  VerticalAlign,
} from '@slider/shared';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, IconButton, type IconName } from '@/ui';
import { useEditing } from './editing-context';
import { editorFonts } from './live/fonts';
import {
  alignRange,
  commonValue,
  DEFAULT_STYLE,
  formatRange,
  NEW_BOX,
  richFromLive,
  type TextStylePatch,
} from './live/model';

/*
 * The live editor's formatting, in the floating panel beside the picked element: text – font, size,
 * colour, bold, italic, underline, alignment – and the shape – fill, border, vertical alignment.
 * While one types on the slide it formats the selection (a caret: its word), else the whole
 * element. Buttons keep the focus in the text; fields take it and give it back.
 */

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];

/** Scrolled this far (px) over the focused size field: one size up or down. */
const WHEEL_STEP = 50;

const nextSize = (size: number, step: 1 | -1) =>
  step > 0
    ? (SIZES.find((value) => value > size + 0.01) ?? size + 8)
    : ([...SIZES].reverse().find((value) => value < size - 0.01) ?? Math.max(1, size - 1));

const ALIGNS: { value: TextAlign; icon: IconName; label: string }[] = [
  { value: 'left', icon: 'formatAlignLeft', label: 'Linksbündig' },
  { value: 'center', icon: 'formatAlignCenter', label: 'Zentriert' },
  { value: 'right', icon: 'formatAlignRight', label: 'Rechtsbündig' },
  { value: 'justify', icon: 'formatAlignJustify', label: 'Blocksatz' },
];

const VERTICAL: { value: VerticalAlign; icon: IconName; label: string }[] = [
  { value: 'top', icon: 'verticalAlignTop', label: 'Oben' },
  { value: 'middle', icon: 'verticalAlignCenter', label: 'Mittig' },
  { value: 'bottom', icon: 'verticalAlignBottom', label: 'Unten' },
];

export const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** A row of the panel: a short label, its controls on the right. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-auto text-xs text-fg-subtle">{label}</span>
      {children}
    </div>
  );
}

/** A colour dot, like a pen's: a click opens the system's colour picker. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label
      title={label}
      className="relative mx-1 size-5 shrink-0 cursor-pointer rounded-full ring-1 ring-border ring-offset-0 focus-within:ring-2 focus-within:ring-border-focus"
      style={{ background: value }}
    >
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/** Text controls for a text, shape controls for a shape (or a text box with fill or border). */
export function StyleControls({ element, live }: { element: EditableElement; live: LiveElement }) {
  const text = element.paragraphs !== null;
  const shape = element.kind === 'shape' || live.fill !== null || live.stroke !== null;
  return (
    <>
      {text && <TextControls element={element} live={live} />}
      {text && shape && <span className="h-px bg-border" aria-hidden />}
      {shape && <BoxControls element={element} live={live} />}
    </>
  );
}

function TextControls({ element, live }: { element: EditableElement; live: LiveElement }) {
  const editing = useEditing();
  const fontId = useId();
  const typing = editing.textEditing === element.id ? editing.textEditor : null;
  const value = <K extends keyof LiveTextStyle>(key: K): LiveTextStyle[K] | null =>
    typing ? typing.style[key] : commonValue(live.paragraphs, key);
  const font = value('font');
  const size = value('size');
  const color = value('color') ?? DEFAULT_STYLE.color;
  const aligns = new Set(live.paragraphs.map((paragraph) => paragraph.align));
  const align = typing ? typing.align : aligns.size === 1 ? [...aligns][0] : null;

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
  const alignTo = (next: TextAlign) => {
    if (typing) {
      typing.alignText(next);
      return;
    }
    void editing.apply([
      {
        type: 'setRichText',
        elementId: element.id,
        paragraphs: richFromLive(alignRange(live.paragraphs, null, next)),
      },
    ]);
  };
  const toggle = (key: 'bold' | 'italic' | 'underline') => format({ [key]: !value(key) });
  const offered = editorFonts();
  const fonts = font && !offered.includes(font) ? [font, ...offered] : offered;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <select
          id={fontId}
          aria-label="Schrift"
          title="Schrift"
          value={font ?? ''}
          onChange={(event) => format({ font: event.target.value })}
          className="field-well focus-field h-8 min-w-0 flex-1 rounded-control-sm px-2 text-sm"
        >
          {!font && <option value="">Gemischt</option>}
          {fonts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <SizeField size={size} onChange={(next) => format({ size: next })} />
      </div>
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
        <Divider />
        {ALIGNS.map((item) => (
          <IconButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            size="compact"
            active={align === item.value}
            onClick={() => alignTo(item.value)}
          />
        ))}
        <span className="ml-auto" />
        <ColorField
          label="Textfarbe"
          value={color}
          onChange={(next) => format({ color: next }, 'color')}
        />
      </div>
    </div>
  );
}

/**
 * The size in points: typed (↑ ↓ or scrolling over it while it has the focus step through the
 * usual sizes), or picked from them in the list the arrow opens – like the font beside it.
 */
function SizeField({ size, onChange }: { size: number | null; onChange: (size: number) => void }) {
  const shown = size === null ? '' : String(Number(size.toFixed(1)));
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ size, onChange });
  useLayoutEffect(() => {
    latest.current = { size, onChange };
  });

  // Native and not passive: React's wheel listener cannot keep the stage from scrolling.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let scrolled = 0;
    const onWheel = (event: WheelEvent) => {
      if (document.activeElement !== input) return;
      event.preventDefault();
      const { size, onChange } = latest.current;
      if (size === null) return;
      scrolled += event.deltaY;
      if (Math.abs(scrolled) < WHEEL_STEP) return;
      scrolled = 0;
      setDraft(null);
      onChange(nextSize(size, event.deltaY < 0 ? 1 : -1));
    };
    input.addEventListener('wheel', onWheel, { passive: false });
    return () => input.removeEventListener('wheel', onWheel);
  }, []);
  const commit = () => {
    const value = Number((draft ?? '').replace(',', '.'));
    setDraft(null);
    if (draft !== null && Number.isFinite(value) && value >= 1 && value <= 400) onChange(value);
  };
  return (
    <div className="field-well focus-field flex h-8 w-18 shrink-0 items-center rounded-control-sm pl-2">
      <input
        ref={inputRef}
        aria-label="Schriftgröße (pt)"
        title="Schriftgröße (pt) – ↑ ↓ oder scrollen ändert sie"
        inputMode="decimal"
        value={draft ?? shown}
        placeholder="–"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && size !== null) {
            event.preventDefault();
            setDraft(null);
            onChange(nextSize(size, event.key === 'ArrowUp' ? 1 : -1));
          }
        }}
        className="w-full min-w-0 bg-transparent text-sm tabular-nums outline-none"
      />
      <span className="relative flex h-full w-6 shrink-0 items-center justify-center text-fg-subtle">
        <Icon name="expandMore" size={16} />
        <select
          aria-label="Schriftgröße wählen"
          title="Schriftgröße wählen"
          value=""
          onChange={(event) => onChange(Number(event.target.value))}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="" disabled hidden />
          {SIZES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

function BoxControls({ element, live }: { element: EditableElement; live: LiveElement }) {
  const editing = useEditing();
  const style = (
    change: { fill?: string | null; stroke?: LiveElement['stroke']; verticalAlign?: VerticalAlign },
    coalesce?: string,
  ) =>
    void editing.apply([{ type: 'setShapeStyle', elementId: element.id, ...change }], {
      coalesce: coalesce && `${coalesce}:${element.id}`,
    });
  const stroke = live.stroke;
  return (
    <div className="flex flex-col gap-1.5">
      <Line label="Füllung">
        {live.fill && (
          <ColorField
            label="Füllfarbe"
            value={live.fill}
            onChange={(fill) => style({ fill }, 'fill')}
          />
        )}
        <IconButton
          icon={live.fill ? 'formatColorReset' : 'formatColorFill'}
          label={live.fill ? 'Keine Füllung' : 'Füllung hinzufügen'}
          size="compact"
          onClick={() => style({ fill: live.fill ? null : NEW_BOX.fill })}
        />
      </Line>
      <Line label="Rahmen">
        {stroke && (
          <>
            <StrokeWidthField
              width={stroke.width}
              onChange={(width) => style({ stroke: { ...stroke, width } }, 'stroke')}
            />
            <ColorField
              label="Rahmenfarbe"
              value={stroke.color}
              onChange={(color) => style({ stroke: { ...stroke, color } }, 'stroke')}
            />
          </>
        )}
        <IconButton
          icon={stroke ? 'borderClear' : 'borderOuter'}
          label={stroke ? 'Kein Rahmen' : 'Rahmen hinzufügen'}
          size="compact"
          onClick={() => style({ stroke: stroke ? null : NEW_BOX.stroke })}
        />
      </Line>
      {element.paragraphs !== null && (
        <Line label="Text in der Form">
          {VERTICAL.map((item) => (
            <IconButton
              key={item.value}
              icon={item.icon}
              label={item.label}
              size="compact"
              active={live.verticalAlign === item.value}
              onClick={() => style({ verticalAlign: item.value })}
            />
          ))}
        </Line>
      )}
    </div>
  );
}

/**
 * The line width in points. Shown to 0.05 pt: a 1 pt line from a file stored in cm (0.035 cm)
 * reads 0.992 pt. While one types, the field keeps what was typed – the answer of each step does
 * not overwrite it.
 */
function StrokeWidthField({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label="Rahmenstärke (pt)"
      title="Rahmenstärke (pt)"
      type="number"
      min={0}
      max={20}
      step={0.25}
      value={draft ?? String(Math.round(width * 20) / 20)}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = Number(event.target.value.replace(',', '.'));
        if (event.target.value !== '' && Number.isFinite(next) && next >= 0 && next <= 20) {
          onChange(next);
        }
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="field-well focus-field h-8 w-14 rounded-control-sm px-1 text-center text-xs tabular-nums"
    />
  );
}
