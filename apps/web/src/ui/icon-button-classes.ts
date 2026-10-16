import { cn } from './cn';

export type IconButtonVariant = 'ghost' | 'subtle' | 'glass' | 'primary' | 'danger';
/** xs 24 · compact 28 · sm 32 · lg 36 · md 40 (px). */
export type IconButtonSize = 'xs' | 'compact' | 'sm' | 'lg' | 'md';

export interface IconButtonStyle {
  variant?: IconButtonVariant | undefined;
  size?: IconButtonSize | undefined;
  /** `round` for media controls and floating close buttons. */
  shape?: 'square' | 'round' | undefined;
  /** Pressed / selected look (`bg-selected`). */
  active?: boolean | undefined;
  /** Icon colour instead of the variant's text colour, e.g. the green send arrow. */
  iconTone?: 'success' | undefined;
  /**
   * `fade` (default): the whole button at 40 %. `dim`: only the icon turns `fg-faint` – for
   * coloured icons (send) that should read as "not yet" rather than "off".
   */
  disabledStyle?: 'fade' | 'dim' | undefined;
}

/** Text colour + hover per variant; the `aria-expanded` step follows docs §9. */
const variantClasses: Record<IconButtonVariant, { fill: string; text: string }> = {
  ghost: {
    fill: 'hover:bg-hover aria-expanded:bg-hover',
    text: 'text-fg-muted hover:text-fg aria-expanded:text-fg',
  },
  subtle: {
    fill: 'hover:bg-hover aria-expanded:bg-hover',
    text: 'text-fg-subtle hover:text-fg aria-expanded:text-fg',
  },
  glass: { fill: 'glass-control hover:bg-selected aria-expanded:bg-selected', text: 'text-fg' },
  primary: { fill: 'bg-primary hover:bg-primary-hover', text: 'text-on-primary' },
  danger: { fill: 'bg-danger hover:bg-danger/85', text: 'text-fg' },
};

/** Concentric radius per size (docs §5); `round` overrides it. */
const sizeClasses: Record<IconButtonSize, { box: string; radius: string }> = {
  xs: { box: 'size-6', radius: 'rounded-badge' },
  compact: { box: 'size-7', radius: 'rounded-chip' },
  sm: { box: 'size-8', radius: 'rounded-control' },
  lg: { box: 'size-9', radius: 'rounded-control' },
  md: { box: 'size-10', radius: 'rounded-control' },
};

export const ICON_BUTTON_ICON_PX: Record<IconButtonSize, number> = {
  xs: 18,
  compact: 18,
  sm: 20,
  lg: 20,
  md: 24,
};

/** The IconButton look as a class string – for triggers that cannot render `IconButton`. */
export function iconButtonClasses({
  variant = 'ghost',
  size = 'md',
  shape = 'square',
  active = false,
  iconTone,
  disabledStyle = 'fade',
}: IconButtonStyle = {}): string {
  const look = variantClasses[variant];
  const selectable = variant === 'ghost' || variant === 'subtle';
  return cn(
    'inline-flex shrink-0 items-center justify-center transition-colors',
    sizeClasses[size].box,
    shape === 'round' ? 'rounded-full' : sizeClasses[size].radius,
    disabledStyle === 'dim'
      ? 'disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent'
      : 'disabled:pointer-events-none disabled:opacity-40',
    active && selectable ? 'bg-selected text-fg' : look.fill,
    !(active && selectable) && (iconTone === 'success' ? 'text-success' : look.text),
  );
}
