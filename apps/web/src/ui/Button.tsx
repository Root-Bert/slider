import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** UI kit "Button": Primary = white 90 % / black text, Secondary = glass, Ghost = text only. */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-white',
  secondary: 'glass text-fg hover:bg-white/15',
  ghost: 'text-fg-muted hover:text-fg hover:bg-white/5',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-control-sm',
  md: 'h-9 px-4 text-sm gap-2 rounded-control',
  lg: 'h-11 px-5 text-sm gap-2 rounded-control',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={16} /> : icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
