import type { ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { ButtonContent } from './Button';
import { buttonClasses, type ButtonStyle } from './button-classes';
import { cn } from './cn';
import type { IconName, IconSize } from './Icon';

export interface ButtonLinkProps extends LinkProps, ButtonStyle {
  icon?: IconName;
  trailingIcon?: IconName;
  iconSize?: IconSize;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
}

/** A router `Link` that looks like a `Button` (navigation, not an action). */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  tone,
  weight,
  icon,
  trailingIcon,
  iconSize,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={cn(buttonClasses({ variant, size, tone, weight }), className)} {...props}>
      <ButtonContent size={size} icon={icon} trailingIcon={trailingIcon} iconSize={iconSize}>
        {children}
      </ButtonContent>
    </Link>
  );
}
