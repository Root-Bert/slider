import type { AccentColor } from '@slider/shared';
import { ACCENT_COLORS } from '@slider/shared';
import { accentColor, ACCENT_COLOR_NAMES, onAccentClass } from '@/lib/accent';
import { cn } from './cn';
import { Icon } from './Icon';

/** The surface right behind the swatches – the gap of the selection ring is painted in it. */
export type SwatchRingOffset = 'canvas' | 'glass-solid' | 'placeholder' | 'well-dark' | 'scrim';

const ringOffsetClasses: Record<SwatchRingOffset, string> = {
  canvas: 'ring-offset-canvas',
  'glass-solid': 'ring-offset-glass-solid',
  placeholder: 'ring-offset-placeholder',
  'well-dark': 'ring-offset-well-dark',
  scrim: 'ring-offset-scrim',
};

interface ColorSwatchesProps {
  value: AccentColor | null | undefined;
  onChange: (color: AccentColor) => void;
  /** Colours in order; the six reviewer accents by default. */
  colors?: readonly AccentColor[];
  /** Id of the visible label of the group. */
  labelledBy?: string;
  /** Accessible name of the group when there is no visible label. */
  label?: string;
  /** Accessible name of one swatch; the German colour name by default. */
  swatchLabel?: (color: AccentColor) => string;
  /** Tooltip of one swatch; the swatch label by default. */
  swatchTitle?: string | ((color: AccentColor) => string);
  /** While saving: swatches show a wait cursor and stop reacting. */
  disabled?: boolean;
  /** Button size in px. */
  size?: 28 | 32;
  /**
   * `fill`: the swatch is the colour, the selected one has a check and a ring (a radio group –
   * pick your colour). `dot`: a small dot on a ghost button, the picked one ringed (pressed
   * buttons – pick a pen colour in a tool bar).
   */
  variant?: 'fill' | 'dot';
  ringOffset?: SwatchRingOffset;
  className?: string;
}

/** Accent colour picker: preferences, the avatar popover and the sketch tool bar. */
export function ColorSwatches({
  value,
  onChange,
  colors = ACCENT_COLORS,
  labelledBy,
  label,
  swatchLabel = (color) => ACCENT_COLOR_NAMES[color],
  swatchTitle,
  disabled = false,
  size = 28,
  variant = 'fill',
  ringOffset = variant === 'dot' ? 'placeholder' : 'glass-solid',
  className,
}: ColorSwatchesProps) {
  const fill = variant === 'fill';
  return (
    <div
      role={fill ? 'radiogroup' : 'group'}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn('flex items-center', className)}
    >
      {colors.map((color) => {
        const selected = color === value;
        const name = swatchLabel(color);
        const title =
          swatchTitle === undefined
            ? name
            : typeof swatchTitle === 'function'
              ? swatchTitle(color)
              : swatchTitle;
        const ring = cn('ring-2 ring-fg ring-offset-2', ringOffsetClasses[ringOffset]);
        return (
          <button
            key={color}
            type="button"
            role={fill ? 'radio' : undefined}
            aria-checked={fill ? selected : undefined}
            aria-pressed={fill ? undefined : selected}
            aria-label={name}
            title={title}
            disabled={disabled}
            onClick={() => onChange(color)}
            className={cn(
              'flex items-center justify-center rounded-full',
              size === 32 ? 'size-8' : 'size-7',
              fill
                ? cn(
                    'outline-offset-2 transition-transform hover:scale-110 disabled:cursor-wait disabled:hover:scale-100',
                    selected && ring,
                  )
                : 'transition-colors hover:bg-hover disabled:cursor-wait disabled:hover:bg-transparent',
            )}
            style={fill ? { backgroundColor: accentColor(color) } : undefined}
          >
            {fill ? (
              selected && (
                <Icon name="check" size={size === 32 ? 16 : 14} className={onAccentClass(color)} />
              )
            ) : (
              <span
                className={cn(
                  'size-4 rounded-full inset-ring inset-ring-surface-4',
                  selected && ring,
                )}
                style={{ backgroundColor: accentColor(color) }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
