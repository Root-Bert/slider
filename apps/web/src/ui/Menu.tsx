import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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
 */
export function Menu({ label, actions, className, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDismiss({
    open,
    onDismiss: () => setOpen(false),
    refs: [wrapperRef],
    returnFocusTo: triggerRef,
  });

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
          'inline-flex size-8 items-center justify-center rounded-control transition-colors',
          open ? 'bg-white/15 text-fg' : 'text-fg-muted hover:bg-white/10 hover:text-fg',
          triggerClassName,
        )}
      >
        <Icon name="moreHoriz" size={20} />
      </button>
      {open && (
        <MenuList
          id={menuId}
          label={label}
          actions={actions}
          onClose={() => setOpen(false)}
          // Focus goes back to the trigger first, so a dialog opened by the action restores it on close.
          returnFocusTo={triggerRef}
          className="absolute top-full right-0 mt-1"
        />
      )}
    </div>
  );
}

interface ContextMenuProps {
  /** Accessible name, e.g. "Aktionen für „Q4 Strategie“". */
  label: string;
  actions: readonly MenuAction[];
  /** Viewport point of the right click. */
  at: { x: number; y: number };
  onClose: () => void;
}

/**
 * The same menu at the pointer, for a right click. Rendered into `<body>` so cards with
 * transforms or overflow cannot clip it, and moved back inside the viewport near the edges.
 */
export function ContextMenu({ label, actions, at, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: at.x, top: at.y });

  useDismiss({ open: true, onDismiss: onClose, refs: [ref] });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const margin = 8;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(margin, Math.min(at.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(at.y, window.innerHeight - height - margin)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    // Scrolling or resizing moves the card away from the menu: close it.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed z-50" style={position}>
      <MenuList label={label} actions={actions} onClose={onClose} />
    </div>,
    document.body,
  );
}

interface MenuListProps {
  id?: string;
  label: string;
  actions: readonly MenuAction[];
  onClose: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

/** The open menu: focuses the first item, ↑/↓/Home/End move, Tab closes. */
function MenuList({ id, label, actions, onClose, returnFocusTo, className }: MenuListProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  const focusItem = (index: number) => {
    const count = actions.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      onClose();
    }
  };

  const select = (action: MenuAction) => {
    onClose();
    returnFocusTo?.current?.focus();
    action.onSelect();
  };

  return (
    <div
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        'glass-elevated z-30 flex min-w-48 animate-pop-in flex-col rounded-panel p-1',
        className,
      )}
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
            'flex h-9 items-center gap-2.5 rounded-control px-2.5 text-left text-[13px] outline-none',
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
  );
}
