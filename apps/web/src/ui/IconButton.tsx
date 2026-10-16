import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';
import { Icon, type IconName, type IconSize } from './Icon';
import {
  ICON_BUTTON_ICON_PX,
  iconButtonClasses,
  type IconButtonStyle,
} from './icon-button-classes';

export type { IconButtonSize, IconButtonStyle, IconButtonVariant } from './icon-button-classes';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'>, IconButtonStyle {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. Also the tooltip unless `title` is set. */
  label: string;
  /** Tooltip, when it should say more than the label (e.g. a shortcut); `false` for none. */
  title?: string | false;
  /**
   * Trigger of a menu or popover: sets `aria-expanded` and the open background. Not a toggle,
   * so it never sets `aria-pressed`.
   */
  expanded?: boolean;
  iconSize?: IconSize;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  title,
  variant,
  size = 'md',
  shape,
  active = false,
  expanded,
  iconTone,
  disabledStyle,
  iconSize,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title === false ? undefined : (title ?? label)}
      aria-pressed={active || undefined}
      aria-expanded={expanded}
      className={cn(
        iconButtonClasses({ variant, size, shape, active, iconTone, disabledStyle }),
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={iconSize ?? ICON_BUTTON_ICON_PX[size]} />
    </button>
  );
}
