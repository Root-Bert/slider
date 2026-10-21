import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type NoticeVariant = 'glass' | 'tinted' | 'plain' | 'inline';

const DEFAULT_ICONS: Record<NoticeTone, IconName | undefined> = {
  info: undefined,
  success: 'checkCircle',
  warning: 'warning',
  danger: 'error',
  neutral: undefined,
};

const ICON_COLORS: Record<NoticeTone, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-fg-muted',
};

/** Status tints at the /10 step (design-system §2). */
const TINTS: Record<NoticeTone, string> = {
  info: 'bg-info/10',
  success: 'bg-success/10',
  warning: 'bg-warning/10',
  danger: 'bg-danger/10',
  neutral: 'bg-surface-1',
};

export interface NoticeProps {
  tone?: NoticeTone;
  /**
   * `glass`: frosted card on the dot grid (setup page). `tinted`: status-tinted box (login error,
   * created invite). `plain`: quiet 5 % well inside a card (hints, "not set up"). `inline`: no
   * box, just the 18px icon and a subtle 13px line (e.g. "browser has no passkeys").
   */
  variant?: NoticeVariant;
  /** `sm`: tighter box for use inside a card (12px radius and padding, 18px icon). */
  size?: 'md' | 'sm';
  title?: ReactNode;
  /** Defaults per tone (success ✓, warning, danger ⓘ; none for info / neutral). `false` hides it. */
  icon?: IconName | false;
  /** Shows a close button (top right). */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Below the message, full width (e.g. a copy field). */
  footer?: ReactNode;
  /** `alert` for errors that appear after an action, `status` for confirmations. */
  role?: 'alert' | 'status';
  /** Fades in when it appears. */
  animated?: boolean;
  /** Layout only; the look comes from the props. */
  className?: string;
  children?: ReactNode;
}

/** Callout box: icon, optional title, message, optional dismiss and footer. */
export function Notice({
  tone = 'info',
  variant = 'glass',
  size = 'md',
  title,
  icon,
  onDismiss,
  dismissLabel = 'Schließen',
  footer,
  role,
  animated = false,
  className,
  children,
}: NoticeProps) {
  const iconName = icon === false ? undefined : (icon ?? DEFAULT_ICONS[tone]);
  const small = size === 'sm';
  const iconSize = small || variant === 'plain' || variant === 'inline' ? 18 : 20;
  const iconNode = iconName && (
    <Icon name={iconName} size={iconSize} className={ICON_COLORS[tone]} data-slot="icon" />
  );

  if (variant === 'inline') {
    return (
      <div
        role={role}
        className={cn(
          'flex items-center gap-2 text-body text-fg-subtle',
          animated && 'animate-fade-in',
          className,
        )}
      >
        {iconNode}
        <div className="min-w-0 flex-1">
          {title && <span className="font-medium text-fg">{title} </span>}
          {children}
        </div>
        {onDismiss && <Dismiss label={dismissLabel} onClick={onDismiss} />}
      </div>
    );
  }

  const box = cn(
    small
      ? 'rounded-control p-3'
      : variant === 'plain'
        ? 'rounded-control px-4 py-3'
        : 'rounded-panel px-4 py-3',
    variant === 'glass' && 'glass',
    variant === 'tinted' && TINTS[tone],
    variant === 'plain' && 'bg-surface-1',
  );

  // Plain wells put the icon in the title line; the other variants give it its own column.
  if (variant === 'plain') {
    return (
      <div
        role={role}
        className={cn(
          'flex flex-col gap-2 text-left',
          box,
          animated && 'animate-fade-in',
          className,
        )}
      >
        {(title || onDismiss) && (
          <div className="flex items-start gap-2">
            {title && (
              <p className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-fg">
                {iconNode}
                {title}
              </p>
            )}
            {onDismiss && <Dismiss label={dismissLabel} onClick={onDismiss} />}
          </div>
        )}
        {!title && iconNode ? (
          <div className="flex items-center gap-2 text-body leading-5 text-fg-subtle">
            {iconNode}
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        ) : (
          children && <div className="text-body leading-5 text-fg-subtle">{children}</div>
        )}
        {footer}
      </div>
    );
  }

  const bodyClasses =
    variant === 'glass'
      ? 'text-sm leading-5 text-fg-muted'
      : cn('text-body leading-5', small && !title ? 'text-fg' : 'text-fg-muted');

  return (
    <div
      role={role}
      className={cn('flex flex-col gap-3 text-left', box, animated && 'animate-fade-in', className)}
    >
      <div className={cn('flex items-start', small ? 'gap-2' : 'gap-3')}>
        {iconNode && (
          <span
            className={cn('flex shrink-0', variant === 'tinted' && (small ? 'mt-px' : 'mt-0.5'))}
          >
            {iconNode}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title && <p className="text-sm font-medium text-fg">{title}</p>}
          {children && <div className={bodyClasses}>{children}</div>}
        </div>
        {onDismiss && <Dismiss label={dismissLabel} onClick={onDismiss} />}
      </div>
      {footer}
    </div>
  );
}

function Dismiss({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton
      icon="close"
      size="sm"
      iconSize={18}
      label={label}
      onClick={onClick}
      className="-mt-1 -mr-1"
    />
  );
}
