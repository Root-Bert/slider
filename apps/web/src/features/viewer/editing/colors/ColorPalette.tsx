import type { TemplateColor } from '@slider/shared';
import {
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, Icon, IconButton, NumberField, usePopover } from '@/ui';
import { placeBelowOrAbove, type Placement } from '../../lib/geometry';
import { TEXT_TOOLBAR_ATTR } from '../live/model';
import { hexToHsv, hsvToHex, withOpacity, type Hsv } from './hsv';
import { sameColor, useDeckColors } from './useDeckColors';

/*
 * Every colour in the editor is picked here, the same way – a text's, a fill layer's, a gradient
 * stop's, a shadow's, a border's, a slide background's, a template's: a field to pick from
 * (saturation × brightness), the hue under it, how opaque (where the colour has an opacity), the
 * colour as hex and in percent, a pipette where the browser has one, then the deck's colours –
 * the template's (else a few general ones) and its own („Eigene“).
 */

const swatchClass = (selected: boolean) =>
  cn(
    'size-5 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    selected && 'ring-2 ring-fg ring-offset-1 ring-offset-glass-solid',
  );

const hexName = (color: string) => color.slice(1).toUpperCase();

/** A colour as `RRGGBB`, typed. */
export function HexField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="field-well focus-field flex h-7 min-w-0 flex-1 items-center gap-1 rounded-control-sm px-2">
      <span className="text-xs text-fg-subtle">#</span>
      <input
        aria-label="Farbe als Hex"
        value={draft ?? value.slice(1).toUpperCase()}
        maxLength={7}
        onChange={(event) => {
          setDraft(event.target.value);
          const hex = event.target.value.replace(/^#/, '');
          if (/^[0-9a-f]{6}$/i.test(hex)) onChange(`#${hex.toLowerCase()}`);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="w-full min-w-0 bg-transparent text-xs uppercase tabular-nums outline-none"
      />
    </span>
  );
}

/** A fraction (0–1) in percent: an opacity, where a colour sits (`NumberField`). */
export function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      label={label}
      unit="%"
      value={Math.round(value * 100)}
      onChange={(percent) => onChange(percent / 100)}
      min={0}
      max={100}
      step={1}
    />
  );
}

/** Where the pointer is over `element`, as fractions of its width and height (0–1). */
function fractionsAt(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect();
  const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** Follows the pointer from a press on the element until it lets go. */
function dragOn(
  event: ReactPointerEvent<HTMLElement>,
  onMove: (at: { x: number; y: number }) => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget;
  // Focused for the arrows after, without the keyboard's ring.
  target.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  target.setPointerCapture(event.pointerId);
  onMove(fractionsAt(target, event));
  const move = (next: PointerEvent) => onMove(fractionsAt(target, next));
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

/** ←/→ (or ↓/↑) by a step, ⇧ by ten: the next value, else `null` (another key). */
function stepped(event: ReactKeyboardEvent, value: number, step: number, axis: 'x' | 'y' | 'xy') {
  const big = event.shiftKey ? 10 : 1;
  const keys: Record<string, number> =
    axis === 'y'
      ? { ArrowUp: 1, ArrowDown: -1 }
      : axis === 'x'
        ? { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 1, ArrowDown: -1 }
        : { ArrowRight: 1, ArrowLeft: -1 };
  const direction = keys[event.key];
  if (direction === undefined) return null;
  event.preventDefault();
  return value + direction * step * big;
}

const THUMB =
  'pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white shadow-sm';

/** Saturation (→) and brightness (↑) of one hue, picked by pointer or arrows. */
function ShadeField({ hsv, onChange }: { hsv: Hsv; onChange: (hsv: Hsv) => void }) {
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Sättigung und Helligkeit"
      aria-valuetext={`Sättigung ${Math.round(hsv.s * 100)} %, Helligkeit ${Math.round(hsv.v * 100)} %`}
      aria-valuenow={Math.round(hsv.s * 100)}
      onPointerDown={(event) => dragOn(event, ({ x, y }) => onChange({ ...hsv, s: x, v: 1 - y }))}
      onKeyDown={(event) => {
        const s = stepped(event, hsv.s, 0.01, 'xy');
        const v = s === null ? stepped(event, hsv.v, 0.01, 'y') : null;
        if (s !== null) onChange({ ...hsv, s: Math.min(1, Math.max(0, s)) });
        else if (v !== null) onChange({ ...hsv, v: Math.min(1, Math.max(0, v)) });
      }}
      className="relative h-36 cursor-crosshair touch-none rounded-control-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`,
      }}
    >
      <span
        className={THUMB}
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: hsvToHex(hsv),
        }}
      />
    </div>
  );
}

/** A bar picking a value from 0 to `max` along it – the hue, the opacity. */
function Track({
  label,
  value,
  max,
  unit,
  background,
  checkered = false,
  thumb,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  background: string;
  checkered?: boolean;
  thumb: string;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(0, next));
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} ${unit}`}
      onPointerDown={(event) => dragOn(event, ({ x }) => onChange(clamp(x * max)))}
      onKeyDown={(event) => {
        const next = stepped(event, value, max / 100, 'x');
        if (next !== null) onChange(clamp(next));
      }}
      className={cn(
        'relative h-3 cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        checkered && 'checkerboard',
      )}
    >
      <span
        className="absolute inset-0 rounded-full ring-1 ring-border ring-inset"
        style={{ background }}
      />
      <span className={cn(THUMB, 'top-1/2')} style={{ left: `${(value / max) * 100}%` }}>
        <span className="block size-full rounded-full" style={{ background: thumb }} />
      </span>
    </div>
  );
}

const HUES =
  'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)';

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperLike {
  open: () => Promise<EyeDropperResult>;
}
const eyeDropper = (): (new () => EyeDropperLike) | null =>
  typeof window !== 'undefined' && 'EyeDropper' in window
    ? (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper
    : null;

/** A colour from anywhere on screen, as hex; `null` when one cancels. */
async function pickFromScreen(): Promise<string | null> {
  const Dropper = eyeDropper();
  if (!Dropper) return null;
  try {
    const { sRGBHex } = await new Dropper().open();
    if (/^#[0-9a-f]{6}$/i.test(sRGBHex)) return sRGBHex.toLowerCase();
    // Some browsers answer `rgb(r, g, b)`.
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(sRGBHex);
    if (!rgb) return null;
    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`;
  } catch {
    return null;
  }
}

/**
 * The colour picked as HSV – kept while it is the colour shown, so a grey keeps its hue and the
 * field does not jump; taken anew when the colour changes elsewhere (undo, a swatch, hex).
 */
function useHsv(value: string | null): [Hsv, (hsv: Hsv) => void] {
  const fallback: Hsv = { h: 0, s: 0, v: 1 };
  const [state, setState] = useState<{ hsv: Hsv; for: string | null }>(() => ({
    hsv: (value && hexToHsv(value)) || fallback,
    for: value,
  }));
  let hsv = state.hsv;
  if (value && !sameColor(value, hsvToHex(state.hsv)) && state.for !== value) {
    const next = hexToHsv(value);
    if (next) {
      // A grey has no hue of its own: the one held stays.
      hsv = next.s === 0 || next.v === 0 ? { ...next, h: state.hsv.h } : next;
      setState({ hsv, for: value });
    }
  }
  return [hsv, (next) => setState({ hsv: next, for: hsvToHex(next) })];
}

function Swatches({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className="text-xs text-fg-subtle">
        {label}
      </h3>
      <div className="-m-0.5 flex flex-wrap gap-2 p-0.5">{children}</div>
    </section>
  );
}

/**
 * The picker itself (see the top of the file). `onChange` gets every step while one drags;
 * `opacity` and `onOpacity`: the colour has an opacity, picked under the hue and typed in percent.
 */
export function ColorPalette({
  value,
  onChange,
  opacity,
  onOpacity,
}: {
  value: string | null;
  onChange: (color: string) => void;
  opacity?: number;
  onOpacity?: (opacity: number) => void;
}) {
  const { colors, fromTemplate, custom, addCustom, removeCustom } = useDeckColors();
  const [hsv, setHsv] = useHsv(value);
  const shown = value ?? hsvToHex(hsv);
  const pick = (next: Hsv) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const withAlpha = opacity !== undefined && onOpacity !== undefined;
  const swatch = ({ color, name }: TemplateColor) => {
    const title = name ? `${name} · ${hexName(color)}` : hexName(color);
    return (
      <button
        key={color + name}
        type="button"
        aria-label={title}
        title={title}
        aria-pressed={sameColor(value, color)}
        onClick={() => onChange(color)}
        className={swatchClass(sameColor(value, color))}
        style={{ backgroundColor: color }}
      />
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <ShadeField hsv={hsv} onChange={pick} />
        <div className="flex items-center gap-2">
          {eyeDropper() && (
            <IconButton
              icon="colorize"
              label="Farbe vom Bildschirm nehmen"
              size="compact"
              onClick={() =>
                void pickFromScreen().then((color) => {
                  if (color) onChange(color);
                })
              }
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-1.5">
            <Track
              label="Farbton"
              value={hsv.h}
              max={360}
              unit="°"
              background={HUES}
              thumb={hsvToHex({ h: hsv.h, s: 1, v: 1 })}
              onChange={(h) => pick({ ...hsv, h })}
            />
            {withAlpha && (
              <Track
                label="Deckkraft"
                value={opacity * 100}
                max={100}
                unit="%"
                checkered
                background={`linear-gradient(to right, ${withOpacity(shown, 0)}, ${shown})`}
                thumb={withOpacity(shown, opacity)}
                onChange={(percent) => onOpacity(Math.round(percent) / 100)}
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <HexField value={shown} onChange={onChange} />
          {withAlpha && <PercentField label="Deckkraft (%)" value={opacity} onChange={onOpacity} />}
        </div>
      </div>
      <Swatches label={fromTemplate ? 'Vorlage' : 'Farben'}>{colors.map(swatch)}</Swatches>
      <Swatches label="Eigene">
        {custom.map((color) => (
          <span key={color} className="group relative">
            <button
              type="button"
              aria-label={hexName(color)}
              title={`${hexName(color)} – Entf löscht sie aus „Eigene“`}
              aria-pressed={sameColor(value, color)}
              onClick={() => onChange(color)}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                removeCustom(color);
              }}
              className={swatchClass(sameColor(value, color))}
              style={{ backgroundColor: color }}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              title="Aus „Eigene“ löschen"
              onClick={() => removeCustom(color)}
              className="absolute -top-1 -right-1 hidden size-3.5 items-center justify-center rounded-full bg-surface-4 text-fg group-hover:flex"
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label="Diese Farbe zu „Eigene“"
          title="Diese Farbe zu „Eigene“"
          disabled={custom.some((color) => sameColor(shown, color))}
          onClick={() => addCustom(shown)}
          className="flex size-5 items-center justify-center rounded-full text-fg-muted ring-1 ring-border ring-dashed hover:bg-hover disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <Icon name="add" size={12} />
        </button>
      </Swatches>
    </div>
  );
}

/** A panel in the body beside `anchorRef`: the panels and lists it sits in would clip it. */
export function FloatingPanel({
  anchorRef,
  panelRef,
  panelId,
  label,
  className,
  flush = false,
  matchWidth = false,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  panelId: string;
  label: string;
  className?: string;
  /** No padding: a list that fills it. */
  flush?: boolean;
  /** As wide as what opens it, right under it – a dropdown's list. */
  matchWidth?: boolean;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      if (matchWidth) panel.style.width = `${anchor.offsetWidth}px`;
      setPlacement(
        placeBelowOrAbove(
          anchor.getBoundingClientRect(),
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          8,
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    if (matchWidth) observer.observe(anchor);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, panelRef, matchWidth]);
  return createPortal(
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={label}
      // Part of the format bar: typing on the slide goes on while one picks here.
      {...{ [TEXT_TOOLBAR_ATTR]: '' }}
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex animate-pop-in flex-col rounded-panel',
        !flush && 'p-3',
        !placement && 'invisible',
        className,
      )}
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0 }}
    >
      {children}
    </section>,
    document.body,
  );
}

/** A colour on a dot (see-through on a checkerboard), as the picker shows it. */
export function ColorDot({
  color,
  opacity = 1,
  className,
}: {
  color: string;
  opacity?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('checkerboard relative block overflow-hidden rounded-full', className)}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ background: withOpacity(color, opacity) }} />
    </span>
  );
}

/**
 * A colour dot, like a pen's: a click opens the picker ({@link ColorPalette}) under it.
 * `opacity`/`onOpacity`: the colour has an opacity too.
 */
export function ColorField({
  label,
  value,
  onChange,
  opacity,
  onOpacity,
  size = 'sm',
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  opacity?: number;
  onOpacity?: (opacity: number) => void;
  size?: 'sm' | 'md';
}) {
  const { open, triggerProps, triggerRef, wrapperRef, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  return (
    <span ref={wrapperRef} className="flex shrink-0">
      <button
        type="button"
        {...triggerProps}
        aria-label={label}
        title={label}
        className={cn(
          'mx-1 shrink-0 cursor-pointer rounded-full ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          size === 'md' ? 'size-6' : 'size-5',
          open && 'ring-2 ring-fg ring-offset-2 ring-offset-glass-solid',
        )}
      >
        <ColorDot color={value} opacity={opacity} className="size-full" />
      </button>
      {open && (
        <FloatingPanel
          anchorRef={triggerRef}
          panelRef={panelRef}
          panelId={panelId}
          label={label}
          className="w-64"
        >
          <ColorPalette value={value} onChange={onChange} opacity={opacity} onOpacity={onOpacity} />
        </FloatingPanel>
      )}
    </span>
  );
}
