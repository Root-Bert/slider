import { cn } from './cn';

/**
 * - `quiet`: no underline, `fg-subtle` (or `fg-muted` with `tone="muted"`) → `fg` on hover.
 *   Back links, breadcrumbs, "Kopieren".
 * - `underline`: `fg-muted`, underlined (offset 4) → `fg`. Secondary ways out ("Zu meinen Reviews").
 * - `inline`: a link inside running text: `fg`, underlined (offset 2), fades on hover.
 * - `mention`: a URL in a comment body.
 */
export type TextLinkVariant = 'quiet' | 'underline' | 'inline' | 'mention';
export type TextLinkSize = 'inherit' | 'xs' | 'body' | 'sm';

export interface TextLinkStyle {
  variant?: TextLinkVariant | undefined;
  /** `quiet` only: `subtle` (default) or `muted` text at rest. */
  tone?: 'subtle' | 'muted' | undefined;
  /** Text size; `inherit` (default) takes the surrounding text's. */
  size?: TextLinkSize | undefined;
  weight?: 'normal' | 'medium' | undefined;
}

const variantClasses: Record<Exclude<TextLinkVariant, 'quiet'>, string> = {
  underline: 'text-fg-muted underline underline-offset-4 transition-colors hover:text-fg',
  inline: 'text-fg underline underline-offset-2 transition-opacity hover:opacity-80',
  mention: 'text-mention underline underline-offset-2 transition-colors hover:text-fg',
};

const sizeClasses: Record<TextLinkSize, string | undefined> = {
  inherit: undefined,
  xs: 'text-xs',
  body: 'text-body',
  sm: 'text-sm',
};

/** The TextLink look as a class string. */
export function textLinkClasses({
  variant = 'quiet',
  tone = 'subtle',
  size = 'inherit',
  weight = 'normal',
}: TextLinkStyle = {}): string {
  return cn(
    variant === 'quiet'
      ? cn(tone === 'muted' ? 'text-fg-muted' : 'text-fg-subtle', 'transition-colors hover:text-fg')
      : variantClasses[variant],
    sizeClasses[size],
    weight === 'medium' && 'font-medium',
  );
}
