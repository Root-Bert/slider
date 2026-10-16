import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps, type To } from 'react-router';
import { cn } from './cn';
import { Icon, type IconName, type IconSize } from './Icon';
import { textLinkClasses, type TextLinkStyle } from './text-link-classes';

export type { TextLinkSize, TextLinkStyle, TextLinkVariant } from './text-link-classes';

interface TextLinkBase extends TextLinkStyle {
  icon?: IconName | undefined;
  trailingIcon?: IconName | undefined;
  iconSize?: IconSize | undefined;
  children: ReactNode;
}

/** Router link (`to`), external link (`href`) or link-styled button (neither). */
export type TextLinkProps = TextLinkBase &
  (
    | (Omit<LinkProps, 'children'> & { to: To; href?: never; ref?: Ref<HTMLAnchorElement> })
    | (Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
        href: string;
        to?: never;
        ref?: Ref<HTMLAnchorElement>;
      })
    | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
        to?: never;
        href?: never;
        ref?: Ref<HTMLButtonElement>;
      })
  );

export function TextLink(props: TextLinkProps) {
  const {
    variant,
    tone,
    size,
    weight,
    icon,
    trailingIcon,
    iconSize = 16,
    className,
    children,
    ...rest
  } = props;
  const hasIcon = Boolean(icon || trailingIcon);
  const classes = cn(
    textLinkClasses({ variant, tone, size, weight }),
    hasIcon && 'inline-flex items-center gap-1',
    className,
  );
  const content = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={iconSize} />}
    </>
  );

  if ('to' in rest && rest.to !== undefined) {
    return (
      <Link {...(rest as LinkProps)} className={classes}>
        {content}
      </Link>
    );
  }
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={classes}>
        {content}
      </a>
    );
  }
  const { type = 'button', ...button } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} {...button} className={classes}>
      {content}
    </button>
  );
}

/** "← Zurück zu den Reviews" above a settings-style page title. */
export function BackLink({
  to,
  label = 'Zurück zu den Reviews',
  className,
}: {
  to: To;
  label?: string;
  className?: string;
}) {
  return (
    <TextLink to={to} size="body" icon="arrowBack" className={cn('w-fit', className)}>
      {label}
    </TextLink>
  );
}
