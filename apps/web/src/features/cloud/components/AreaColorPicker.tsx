import { useRef, useState, type KeyboardEvent } from 'react';
import { ACCENT_COLORS, type CloudAreaColor } from '@slider/shared';
import { ACCENT_COLOR_NAMES } from '@/lib/accent';
import { cn, ColorMixer, Icon } from '@/ui';
import { areaColor } from './AreaDot';

/** The colours on offer: the six accents, then more to tell many areas apart. */
const MORE: readonly { color: `#${string}`; name: string }[] = [
  { color: '#f97316', name: 'Orange' },
  { color: '#ec4899', name: 'Pink' },
  { color: '#14b8a6', name: 'Türkis' },
  { color: '#84cc16', name: 'Limette' },
  { color: '#6366f1', name: 'Indigo' },
  { color: '#a16207', name: 'Braun' },
  { color: '#64748b', name: 'Grau' },
  { color: '#111827', name: 'Schwarz' },
];
export const AREA_COLORS: readonly { color: CloudAreaColor; name: string }[] = [
  ...ACCENT_COLORS.map((color) => ({ color, name: ACCENT_COLOR_NAMES[color] })),
  ...MORE,
];

/** Dark fills take a white check, bright ones a black one. */
function onFill(color: CloudAreaColor): string {
  const light: readonly string[] = ['yellow', 'green', 'cyan'];
  if (!color.startsWith('#')) return light.includes(color) ? 'text-black' : 'text-white';
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 160 ? 'text-black' : 'text-white';
}

const SWATCH =
  'flex size-7 items-center justify-center rounded-full outline-offset-2 transition-transform hover:scale-110';
const PICKED = 'ring-2 ring-fg ring-offset-2 ring-offset-glass-solid';

/**
 * An area's colour: one of the colours on offer, or – the last swatch – any colour of one's own,
 * picked in the system's colour dialog. A radio group: one Tab stop, the arrow keys step.
 */
/** Where one's own colour starts – none of the ones on offer. */
const START = '#3b82f7';

export function AreaColorPicker({
  value,
  onChange,
  labelledBy,
  none = false,
}: {
  value: CloudAreaColor | null;
  onChange: (color: CloudAreaColor | null) => void;
  labelledBy: string;
  /** A first swatch for no colour of its own (folders): `null`. */
  none?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [mixing, setMixing] = useState(false);
  const own = value !== null && !AREA_COLORS.some((each) => each.color === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    const stops = [...(group.current?.querySelectorAll<HTMLElement>('[data-swatch]') ?? [])];
    const at = stops.findIndex((stop) => stop === document.activeElement);
    const next = stops[(at + step + stops.length) % stops.length];
    if (!next) return;
    event.preventDefault();
    next.focus();
    // The own colour is mixed under the row, not picked by walking past it.
    if (next.dataset.swatch !== 'own') next.click();
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-3 p-0.5"
      >
        {none && (
          <button
            type="button"
            role="radio"
            data-swatch="none"
            aria-checked={value === null}
            aria-label="Ohne Farbe"
            title="Ohne Farbe"
            tabIndex={value === null ? 0 : -1}
            onClick={() => {
              setMixing(false);
              onChange(null);
            }}
            className={cn(
              SWATCH,
              'bg-surface-3 text-fg inset-ring inset-ring-border',
              value === null && PICKED,
            )}
          >
            {value === null && <Icon name="check" size={14} />}
          </button>
        )}
        {AREA_COLORS.map(({ color, name }) => {
          const picked = color === value;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              data-swatch={color}
              aria-checked={picked}
              aria-label={name}
              title={name}
              tabIndex={
                picked || (value === null && !none && color === AREA_COLORS[0]?.color) ? 0 : -1
              }
              onClick={() => {
                setMixing(false);
                onChange(color);
              }}
              className={cn(SWATCH, picked && PICKED)}
              style={{ backgroundColor: areaColor(color) }}
            >
              {picked && <Icon name="check" size={14} className={onFill(color)} />}
            </button>
          );
        })}
        {/* One's own colour: the swatch opens the mixer under the row – the same one as in Slider. */}
        <button
          type="button"
          role="radio"
          data-swatch="own"
          aria-checked={own}
          aria-expanded={mixing || own}
          aria-label="Eigene Farbe"
          title={own ? `Eigene Farbe ${value}` : 'Eigene Farbe'}
          tabIndex={own ? 0 : -1}
          onClick={() => {
            setMixing(true);
            if (!own) onChange(START);
          }}
          className={cn(SWATCH, own && PICKED)}
          style={{
            background: own
              ? (value ?? undefined)
              : 'conic-gradient(from 90deg, #ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #ef4444)',
          }}
        >
          {own && value ? (
            <Icon name="check" size={14} className={onFill(value)} />
          ) : (
            <Icon name="add" size={16} className="text-white" />
          )}
        </button>
      </div>
      {(mixing || own) && (
        <div className="w-64 max-w-full rounded-panel bg-surface-1 p-3">
          <ColorMixer
            value={own ? value : START}
            onChange={(color) => onChange(color.toLowerCase() as `#${string}`)}
          />
        </div>
      )}
    </div>
  );
}
