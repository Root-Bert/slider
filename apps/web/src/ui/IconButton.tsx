import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. Also used as tooltip. */
  label: string;
  /** Pressed / selected state, e.g. the active drawing tool. */
  active?: boolean;
  size?: 'sm' | 'md';
  iconSize?: number;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  active = false,
  size = 'md',
  iconSize,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cn(
        // Radius of a control nested in a pill with 4px padding (panel − 4), so corners nest.
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'size-10' : 'size-8',
        active ? 'bg-white/15 text-fg' : 'text-fg-muted hover:bg-white/10 hover:text-fg',
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={iconSize ?? (size === 'md' ? 24 : 20)} />
    </button>
  );
}
