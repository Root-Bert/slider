import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { useDismiss } from './useDismiss';

export interface MenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
  tone?: 'default' | 'danger';
}

interface MenuProps {
  /** Accessible name of the trigger, e.g. "Aktionen für „Q4 Strategie“". */
  label: string;
  actions: readonly MenuAction[];
  className?: string;
  triggerClassName?: string;
}

/**
 * Icon-triggered action menu following the WAI-ARIA menu-button pattern:
 * Enter/Space/↓ opens and focuses the first item, ↑/↓/Home/End move, Escape/Tab close.
 * Candidate for `ui/` once a second feature needs it.
 */
export function Menu({ label, actions, className, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useDismiss({
    open,
    onDismiss: () => setOpen(false),
    refs: [wrapperRef],
    returnFocusTo: triggerRef,
  });

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const focusItem = (index: number) => {
    const count = actions.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    const moves: Partial<Record<string, number>> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: actions.length - 1,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      focusItem(target);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const select = (action: MenuAction) => {
    setOpen(false);
    // Focus goes back to the trigger first, so a dialog opened by the action restores it on close.
    triggerRef.current?.focus();
    action.onSelect();
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {/* Not `IconButton`: the UI kit button doesn't forward refs, and the trigger needs one for focus return. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-[10px] transition-colors',
          open ? 'bg-white/15 text-fg' : 'text-fg-muted hover:bg-white/10 hover:text-fg',
          triggerClassName,
        )}
      >
        <Icon name="moreHoriz" size={20} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className="glass-elevated absolute top-full right-0 z-30 mt-1 flex min-w-48 animate-pop-in flex-col rounded-control p-1"
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => select(action)}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] outline-none',
                'hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none',
                action.tone === 'danger' ? 'text-danger' : 'text-fg',
              )}
            >
              <Icon
                name={action.icon}
                size={18}
                className={action.tone === 'danger' ? undefined : 'text-fg-subtle'}
              />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
