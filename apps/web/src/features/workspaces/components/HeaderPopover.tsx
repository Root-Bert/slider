import { useId, type ReactNode } from 'react';
import { cn, PopoverPanel, usePopover } from '@/ui';

/**
 * Header dropdown (workspace switcher, account menu): a trigger button and a glass panel below
 * it. Escape, a click outside or `close` closes it and hands focus back to the trigger. Fill it with
 * `MenuItem` / `MenuDivider` / `MenuHeading` rows (`inset={6}`, the default).
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
  const { open, close, wrapperRef, panelId, triggerProps } = usePopover();
  const triggerId = useId();
  // Focus back on the trigger before the panel (and the focused item) unmounts: a dialog the
  // item opens remembers the trigger, not <body>, and hands the focus back there when it closes.
  // By id: `children` runs during render, where the compiler lint forbids handing out refs.
  const closeAndRefocus = () => {
    document.getElementById(triggerId)?.focus();
    close();
  };

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        type="button"
        id={triggerId}
        aria-label={label}
        {...triggerProps}
        className={triggerClassName}
      >
        {trigger(open)}
      </button>
      {open && (
        <PopoverPanel
          id={panelId}
          align={align === 'left' ? 'start' : 'end'}
          padding="md"
          className={cn('w-[min(320px,calc(100vw-32px))]', panelClassName)}
        >
          {children(closeAndRefocus)}
        </PopoverPanel>
      )}
    </div>
  );
}
