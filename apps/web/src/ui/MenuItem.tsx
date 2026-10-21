import type {
  ComponentPropsWithRef,
  ElementType,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
} from 'react';
import { cn } from './cn';
import { Divider } from './Divider';
import { Icon, type IconName } from './Icon';

interface MenuItemOwnProps<T extends ElementType> {
  /**
   * `button` (default), `a` (full page navigation), a router `Link`, or `div` for a static,
   * non-interactive row (e.g. "Microsoft verbunden").
   */
  as?: T;
  /** An icon name (18px, `text-fg-subtle` unless danger) or any node (avatar, brand mark). */
  icon?: IconName | ReactNode;
  /** Content at the end of the row: a check, a kbd hint, an arrow. */
  trailing?: ReactNode;
  /** The current choice in a list (`bg-surface-2`, `aria-current` on buttons). */
  selected?: boolean;
  tone?: 'default' | 'danger';
  /** `sm` (default): 13px menu row; `md`: 14px option row in a dialog list. */
  size?: 'sm' | 'md';
  /**
   * Padding of the surrounding panel, for concentric corners: `4` → `rounded-control`
   * (menus, `p-1`), `6` (default) → `rounded-control-sm` (header popovers, `p-1.5`).
   */
  inset?: 4 | 6;
  /** Not selectable: no hover, clicks are swallowed, `aria-disabled`. */
  disabled?: boolean;
  /** Disabled rows are dimmed to 40 % (default); `false` keeps full opacity (current location). */
  dimDisabled?: boolean;
  /**
   * A disabled `button` stays focusable (`aria-disabled` instead of `disabled`), e.g. menu items
   * that keep their `title` as the reason and stay in the roving focus order.
   */
  focusableWhenDisabled?: boolean;
  /** One-line label that ends in "…" instead of wrapping. */
  truncate?: boolean;
  children: ReactNode;
}

export type MenuItemProps<T extends ElementType = 'button'> = MenuItemOwnProps<T> &
  Omit<ComponentPropsWithRef<T>, keyof MenuItemOwnProps<T>>;

const sizeClasses = {
  sm: 'min-h-9 gap-2.5 px-2.5 py-1.5 text-body',
  md: 'min-h-9 gap-3 px-3 py-2 text-sm',
} as const;

/**
 * A row in a menu, popover or option list: icon, label, trailing content. Hover and keyboard
 * focus share the `bg-hover` tint; keyboard focus adds an inset mention-blue ring (WCAG 1.4.11).
 */
export function MenuItem<T extends ElementType = 'button'>({
  as,
  icon,
  trailing,
  selected = false,
  tone = 'default',
  size = 'sm',
  inset = 6,
  disabled = false,
  dimDisabled = true,
  focusableWhenDisabled = false,
  truncate = false,
  className,
  children,
  onClick,
  ...props
}: MenuItemProps<T>) {
  const Component: ElementType = as ?? 'button';
  const isButton = Component === 'button';
  const interactive = Component !== 'div';
  const danger = tone === 'danger';

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    (onClick as ((event: MouseEvent<HTMLElement>) => void) | undefined)?.(event);
  };

  return (
    <Component
      {...(isButton && { type: 'button' })}
      {...(isButton && disabled && !focusableWhenDisabled && { disabled: true })}
      aria-disabled={(interactive && disabled) || undefined}
      aria-current={(isButton && selected) || undefined}
      onClick={interactive ? handleClick : undefined}
      className={cn(
        'flex w-full items-center text-left outline-none',
        sizeClasses[size],
        inset === 4 ? 'rounded-control' : 'rounded-control-sm',
        interactive && 'transition-colors',
        interactive &&
          (disabled
            ? 'cursor-default'
            : // The tint alone is ~1.3:1 on glass: keyboard focus adds the inset mention ring.
              'hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-mention focus-visible:outline-none focus-visible:ring-inset'),
        disabled && dimDisabled && 'opacity-40',
        selected && 'bg-surface-2',
        danger ? 'text-danger' : 'text-fg',
        className,
      )}
      {...props}
    >
      {typeof icon === 'string' ? (
        <Icon name={icon as IconName} size={18} className={danger ? undefined : 'text-fg-subtle'} />
      ) : (
        icon
      )}
      <span className={cn('min-w-0 flex-1', truncate ? 'truncate' : 'flex items-center gap-2')}>
        {children}
      </span>
      {trailing}
    </Component>
  );
}

/** Hairline between groups of menu rows. */
export function MenuDivider({ className }: { className?: string }) {
  return <Divider className={cn('mx-2 my-1', className)} />;
}

/** Small uppercase caption above a group of rows ("Organisationen"). Give it an `id` to label a group. */
export function MenuHeading({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'px-2.5 pt-1.5 pb-1 text-caption font-medium tracking-wide text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}
