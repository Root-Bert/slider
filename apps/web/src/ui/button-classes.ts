import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = '2xs' | 'xs' | 'sm' | 'md' | 'field' | 'lg' | 'toolbar';
/**
 * Colour tone on top of the variant:
 * - `subtle`: quieter text (`fg-subtle`) for ghost buttons in dense rows.
 * - `strong`: soft button on glass (`surface-3` → `surface-4`).
 * - `warning`: soft button inside a warning note (`warning/15` → `/25`).
 */
export type ButtonTone = 'default' | 'subtle' | 'strong' | 'warning';
export type ButtonWeight = 'medium' | 'normal';

export interface ButtonStyle {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  tone?: ButtonTone | undefined;
  /** `normal` for quiet text actions in comment rows; buttons are medium by default. */
  weight?: ButtonWeight | undefined;
  /** Soft white halo, brighter on hover – the one main action of a start screen (login, links). */
  glow?: boolean | undefined;
}

/** Background + text per variant; hover and open (`aria-expanded`) per docs §9. */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'glass-control text-fg hover:bg-selected aria-expanded:bg-selected',
  soft: 'bg-surface-2 text-fg hover:bg-selected aria-expanded:bg-selected',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

/** Tones replace the variant's classes where they apply (cn is plain clsx – no merging). */
const toneClasses: Partial<Record<ButtonVariant, Partial<Record<ButtonTone, string>>>> = {
  ghost: {
    subtle:
      'text-fg-subtle hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg',
  },
  soft: {
    strong: 'bg-surface-3 text-fg hover:bg-surface-4 aria-expanded:bg-surface-4',
    warning: 'bg-warning/15 text-warning hover:bg-warning/25 aria-expanded:bg-warning/25',
  },
};

const sizeClasses: Record<ButtonSize, string> = {
  /** Inline text actions inside comment rows ("Aufklappen", "2 frühere Antworten") (20px). */
  '2xs': 'h-5 px-1.5 text-xs gap-1 rounded-badge',
  /** Small text pills in comment rows and notes (24px). */
  xs: 'h-6 px-2 text-xs gap-1 rounded-badge',
  sm: 'h-8 px-3 text-body gap-1.5 rounded-control-sm',
  md: 'h-9 px-4 text-sm gap-2 rounded-control',
  /** Next to a 40px `TextField` / `Select`. */
  field: 'h-10 px-4 text-sm gap-2 rounded-control',
  lg: 'h-11 px-5 text-sm gap-2 rounded-control',
  /** Matches a glass toolbar pill (`p-1` around `h-8` segments). */
  toolbar: 'h-10 px-3.5 text-body gap-1.5 rounded-panel',
};

export const BUTTON_ICON_PX: Record<ButtonSize, number> = {
  '2xs': 16,
  xs: 14,
  sm: 18,
  md: 18,
  field: 18,
  lg: 18,
  toolbar: 18,
};

/** The Button look as a class string – for links (`ButtonLink`) and other non-`<button>`s. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  tone = 'default',
  weight = 'medium',
  glow = false,
}: ButtonStyle = {}): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap',
    glow
      ? 'shadow-glow transition-[background-color,box-shadow] hover:shadow-glow-hover'
      : 'transition-colors',
    weight === 'medium' && 'font-medium',
    'disabled:pointer-events-none disabled:opacity-40',
    toneClasses[variant]?.[tone] ?? variantClasses[variant],
    sizeClasses[size],
  );
}
