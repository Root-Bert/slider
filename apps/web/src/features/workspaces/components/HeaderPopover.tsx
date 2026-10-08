import { useId, useRef, useState, type ReactNode } from 'react';
import { cn, useDismiss } from '@/ui';

/**
 * Header dropdown (workspace switcher, account menu): a trigger button and a glass panel below
 * it. Escape or a click outside closes it and hands focus back to the trigger.
 */
export function HeaderPopover({
  label,
  trigger,
  triggerClassName,
  align = 'left',
  panelClassName,
  children,
}: {
  /** Accessible name of the trigger. */
  label: string;
  trigger: (open: boolean) => ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useDismiss({ open, onDismiss: close, refs: [wrapperRef], returnFocusTo: triggerRef });

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          id={panelId}
          className={cn(
            'glass-elevated absolute top-full z-30 mt-2 flex w-[min(320px,calc(100vw-32px))] animate-pop-in flex-col rounded-panel p-1.5',
            align === 'left' ? 'left-0' : 'right-0',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** A row in a header popover: icon, label, optional trailing content. */
export function PopoverItem({
  icon,
  children,
  trailing,
  onSelect,
  href,
  selected = false,
  tone = 'default',
}: {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
  /** Full page navigation (API redirects such as the Microsoft login). */
  href?: string;
  selected?: boolean;
  tone?: 'default' | 'danger';
}) {
  const className = cn(
    'flex min-h-9 w-full items-center gap-2.5 rounded-control-sm px-2.5 py-1.5 text-left text-[13px] transition-colors',
    'hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none',
    selected && 'bg-white/8',
    tone === 'danger' ? 'text-danger' : 'text-fg',
  );
  const content = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {trailing}
    </>
  );
  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={className}
    >
      {content}
    </button>
  );
}

export const PopoverDivider = () => <div role="separator" className="mx-2 my-1 h-px bg-hairline" />;

export const PopoverHeading = ({ children }: { children: ReactNode }) => (
  <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
    {children}
  </p>
);
