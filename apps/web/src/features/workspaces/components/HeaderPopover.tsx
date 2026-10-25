import { useId, type ReactNode } from 'react';
import { cn, PopoverPanel, usePopover } from '@/ui';

/**
 * Header dropdown (workspace switcher, account menu): a trigger button and a glass panel below
 * it – or, with `unfold`, around it: the trigger stays on top in the panel's corner, and the panel
 * grows out of it (place it over the trigger with `panelClassName`). Escape, a click outside or `close` closes it and hands focus back to the trigger. Fill it with
 * `MenuItem` / `MenuDivider` / `MenuHeading` rows (`inset={6}`, the default).
 */
export function HeaderPopover({
  label,
  trigger,
  triggerClassName,
  align = 'left',
  unfold = false,
  panelClassName,
  children,
}: {
  /** Accessible name of the trigger. */
  label: string;
  trigger: (open: boolean) => ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  unfold?: boolean;
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
        className={cn(triggerClassName, unfold && 'relative z-(--z-popover-anchor)')}
      >
        {trigger(open)}
      </button>
      {open && (
        <PopoverPanel
          id={panelId}
          align={align === 'left' ? 'start' : 'end'}
          padding="md"
          position={unfold ? 'none' : 'anchored'}
          className={cn(
            'w-[min(320px,calc(100vw-32px))]',
            unfold && ['absolute', align === 'left' ? 'origin-top-left' : 'origin-top-right'],
            panelClassName,
          )}
        >
          {children(closeAndRefocus)}
        </PopoverPanel>
      )}
    </div>
  );
}
