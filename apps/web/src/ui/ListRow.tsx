import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ListRowVariant = 'divided' | 'hover' | 'flush';

const LIST_VARIANTS: Record<ListRowVariant, string> = {
  // Rows separated by hairlines, flush with the card's content edge.
  divided: 'flex flex-col divide-y divide-hairline',
  // Rows with their own 8px inset: the list bleeds out by that much so the text stays aligned.
  hover: '-mx-2 flex flex-col',
  flush: '-mx-2 flex flex-col',
};

export interface RowListProps extends HTMLAttributes<HTMLUListElement> {
  /** Same variant as its rows. */
  variant?: ListRowVariant;
}

/** The `<ul>` around `ListRow`s. */
export function RowList({ variant = 'divided', className, ...props }: RowListProps) {
  return <ul className={cn(LIST_VARIANTS[variant], className)} {...props} />;
}

const ROW_VARIANTS: Record<ListRowVariant, string> = {
  divided: 'py-3 first:pt-0 last:pb-0',
  hover: 'hover:bg-surface-1',
  flush: '',
};

/** Inset and radius of `hover` / `flush` rows (the radius follows the padding, §5). */
const ROW_PADDING = {
  /** 8px (members, invites). */
  sm: 'rounded-control-sm px-2 py-2',
  /** 10px (pending invites). */
  md: 'rounded-control-sm p-2.5',
  /** 10px sides, 8px top/bottom, 12px radius (pending invites in the compact popover list). */
  wide: 'rounded-control px-2.5 py-2',
  /** Static header of a menu (account menu): 10px sides, 8px top, 10px bottom. */
  header: 'px-2.5 pt-2 pb-2.5',
} as const;

const TITLE_TONES = {
  fg: 'text-fg',
  muted: 'text-fg-muted',
  subtle: 'text-fg-subtle',
} as const;

export interface ListRowProps {
  /**
   * `divided`: hairline between rows (account logins, passkeys). `hover`: inset row with a quiet
   * hover (members). `flush`: inset row without hover (invites).
   */
  variant?: ListRowVariant;
  /** Inset of `hover` / `flush` rows: `sm` 8px, `md` 10px, `wide` 10×8px, `header` (menu). */
  padding?: keyof typeof ROW_PADDING;
  /** Avatar or `IconTile`. */
  leading?: ReactNode;
  title: ReactNode;
  /** Next to the title, e.g. a `Badge`. */
  badge?: ReactNode;
  /** Second line, `text-xs` subtle, truncated. */
  subtitle?: ReactNode;
  /** Native tooltip on the whole subtitle line (e.g. the exact creation date). */
  subtitleTitle?: string;
  /** `tight`: 2px between title and subtitle (passkeys); default none. */
  textGap?: 'none' | 'tight';
  /** After the text, e.g. a `Select`, a `Badge`, a `Button` or a `Menu`. */
  trailing?: ReactNode;
  /**
   * Fixed 32px cell at the end for an optional icon button, so rows with and without one keep
   * their columns aligned. Rendered whenever the prop is given (also `null` / `false`).
   */
  actionSlot?: ReactNode;
  /** Title size: `sm` 14px (account), `body` 13px (workspace lists). */
  size?: 'sm' | 'body';
  /** `normal` for secondary lists (invites). */
  titleWeight?: 'medium' | 'normal';
  /** Defaults to `muted` when `dimmed`, else `fg`. */
  titleTone?: keyof typeof TITLE_TONES;
  /** Not connected / unavailable: muted title, faded leading. */
  dimmed?: boolean;
  /** `div` outside a list (e.g. the account menu header). */
  as?: 'li' | 'div';
  /** Layout only; the look comes from the props. */
  className?: string;
}

/** A row in a settings list: leading tile or avatar, title + subtitle, trailing controls. */
export function ListRow({
  variant = 'divided',
  padding = 'sm',
  leading,
  title,
  badge,
  subtitle,
  subtitleTitle,
  textGap = 'none',
  trailing,
  actionSlot,
  size = 'sm',
  titleWeight = 'medium',
  titleTone,
  dimmed = false,
  as: Tag = 'li',
  className,
}: ListRowProps) {
  const titleClasses = cn(
    'truncate',
    size === 'sm' ? 'text-sm' : 'text-body',
    titleWeight === 'medium' && 'font-medium',
    TITLE_TONES[titleTone ?? (dimmed ? 'muted' : 'fg')],
  );
  return (
    <Tag
      className={cn(
        'flex items-center gap-3',
        ROW_VARIANTS[variant],
        variant !== 'divided' && ROW_PADDING[padding],
        className,
      )}
    >
      {leading && (
        <span className={cn('flex shrink-0', dimmed && 'opacity-60')} data-slot="leading">
          {leading}
        </span>
      )}
      <span className={cn('flex min-w-0 flex-1 flex-col', textGap === 'tight' && 'gap-0.5')}>
        {badge ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className={titleClasses}>{title}</span>
            {badge}
          </span>
        ) : (
          <span className={titleClasses}>{title}</span>
        )}
        {subtitle !== undefined && (
          <span className="truncate text-xs text-fg-subtle" title={subtitleTitle}>
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
      {actionSlot !== undefined && (
        <span className="flex w-8 shrink-0 justify-end" data-slot="action">
          {actionSlot}
        </span>
      )}
    </Tag>
  );
}
