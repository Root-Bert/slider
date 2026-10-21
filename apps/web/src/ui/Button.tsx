import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { BUTTON_ICON_PX, buttonClasses, type ButtonSize, type ButtonStyle } from './button-classes';
import { cn } from './cn';
import { Icon, type IconName, type IconSize } from './Icon';
import { Spinner } from './Spinner';

export type { ButtonSize, ButtonStyle, ButtonTone, ButtonVariant } from './button-classes';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {
  icon?: IconName;
  trailingIcon?: IconName;
  /** Overrides the size's icon size (scale step or px). */
  iconSize?: IconSize;
  loading?: boolean;
  /** Trigger of a popover or menu: sets `aria-expanded` and the open background. */
  expanded?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Leading icon / spinner, label, trailing icon – shared by `Button` and `ButtonLink`. */
export function ButtonContent({
  size = 'md',
  icon,
  trailingIcon,
  iconSize,
  loading = false,
  children,
}: {
  size?: ButtonSize | undefined;
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  iconSize?: IconSize | undefined;
  loading?: boolean | undefined;
  children: ReactNode;
}) {
  const px = iconSize ?? BUTTON_ICON_PX[size];
  return (
    <>
      {loading ? (
        <Spinner size={size === 'xs' || size === '2xs' ? 14 : 16} />
      ) : (
        icon && <Icon name={icon} size={px} />
      )}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={px} />}
    </>
  );
}

/** UI kit "Button": Primary = white 90 % / black text, Secondary = glass-control, Ghost = text only. */
export function Button({
  variant = 'primary',
  size = 'md',
  tone,
  weight,
  glow,
  icon,
  trailingIcon,
  iconSize,
  loading = false,
  expanded,
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
      aria-expanded={expanded}
      className={cn(buttonClasses({ variant, size, tone, weight, glow }), className)}
      {...props}
    >
      <ButtonContent
        size={size}
        icon={icon}
        trailingIcon={trailingIcon}
        iconSize={iconSize}
        loading={loading}
      >
        {children}
      </ButtonContent>
    </button>
  );
}
