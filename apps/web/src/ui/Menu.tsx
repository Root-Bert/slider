import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import type { IconName } from './Icon';
import { IconButton, type IconButtonSize, type IconButtonVariant } from './IconButton';
import { MenuItem } from './MenuItem';
import { PopoverPanel } from './Popover';
import { useDismiss } from './hooks/useDismiss';
import { usePopover } from './hooks/usePopover';

export interface MenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  /** Greyed out and skipped by the arrow keys, with `title` as the reason. */
  disabled?: boolean;
  title?: string;
}

interface MenuProps {
  /** Accessible name of the trigger, e.g. "Aktionen für „Q4 Strategie“". */
  label: string;
  actions: readonly MenuAction[];
  className?: string;
  /** Size of the `IconButton` trigger: `sm` 32px (default), `compact` 28px, … */
  triggerSize?: IconButtonSize;
  /** Look of the trigger: **ghost**, or `glass` over images (a card thumbnail). */
  triggerVariant?: IconButtonVariant;
  triggerClassName?: string;
}

/**
 * Icon-triggered action menu following the WAI-ARIA menu-button pattern:
 * Enter/Space/↓ opens and focuses the first item, ↑/↓/Home/End move, Escape/Tab close.
 */
export function Menu({
  label,
  actions,
  className,
  triggerSize = 'sm',
  triggerVariant,
  triggerClassName,
}: MenuProps) {
  // Only a keyboard-opened menu puts focus on its first item; a click shouldn't pre-select one.
  const [openedByKeyboard, setOpenedByKeyboard] = useState(false);
  const { open, setOpen, close, wrapperRef, triggerRef, panelId } = usePopover();

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <IconButton
        ref={triggerRef}
        icon="moreHoriz"
        label={label}
        size={triggerSize}
        variant={triggerVariant}
        // aria-expanded and the open look; a menu button is never `aria-pressed`.
        expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          // `detail` is 0 for Enter/Space, the click count for a pointer.
          setOpenedByKeyboard(event.detail === 0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpenedByKeyboard(true);
            setOpen(true);
          }
        }}
        className={triggerClassName}
      />
      {open && (
        <MenuList
          id={panelId}
          label={label}
          actions={actions}
          onClose={close}
          focusFirst={openedByKeyboard}
          // Focus goes back to the trigger first, so a dialog opened by the action restores it on close.
          returnFocusTo={triggerRef}
          anchored
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
    <div ref={ref} className="fixed z-(--z-popover)" style={position}>
      <MenuList label={label} actions={actions} onClose={onClose} focusFirst={false} />
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
  /** Focus the first item (keyboard) or only the menu itself (pointer), so ↑/↓ still work. */
  focusFirst?: boolean;
  /** Below the trigger, right-aligned (`Menu`); otherwise placed by the caller (`ContextMenu`). */
  anchored?: boolean;
}

/** The open menu: ↑/↓/Home/End move between the enabled items, Tab closes. */
function MenuList({
  id,
  label,
  actions,
  onClose,
  returnFocusTo,
  focusFirst = true,
  anchored = false,
}: MenuListProps) {
  const menuRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = actions.flatMap((action, index) => (action.disabled ? [] : [index]));

  useEffect(() => {
    const first = enabled[0];
    if (focusFirst && first !== undefined) itemRefs.current[first]?.focus();
    else menuRef.current?.focus();
    // Only on open – later re-renders (e.g. a progress label) must not move the focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const count = enabled.length;
    // -1 while the menu itself has focus: ↓ goes to the first item, ↑ to the last.
    const current = enabled.findIndex(
      (index) => itemRefs.current[index] === document.activeElement,
    );
    const moves: Partial<Record<string, number>> = {
      ArrowDown: current + 1,
      ArrowUp: current === -1 ? count - 1 : current - 1,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      if (count > 0) itemRefs.current[enabled[(target + count) % count]!]?.focus();
    } else if (event.key === 'Tab') {
      onClose();
    }
  };

  const select = (action: MenuAction) => {
    if (action.disabled) return;
    onClose();
    returnFocusTo?.current?.focus();
    action.onSelect();
  };

  return (
    <PopoverPanel
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      position={anchored ? 'anchored' : 'none'}
      side="bottom"
      align="end"
      offset="sm"
      padding="sm"
      className="min-w-48 outline-none"
    >
      {actions.map((action, index) => (
        <MenuItem
          key={action.label}
          ref={(element: HTMLButtonElement | null) => {
            itemRefs.current[index] = element;
          }}
          role="menuitem"
          tabIndex={-1}
          inset={4}
          icon={action.icon}
          tone={action.tone}
          disabled={action.disabled}
          // Keeps its `title` (the reason) and stays a menuitem; the arrow keys skip it.
          focusableWhenDisabled
          title={action.title}
          onClick={() => select(action)}
          // The pointer moves the focus along, so hover and keyboard never mark two items.
          onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => {
            if (!action.disabled) event.currentTarget.focus({ preventScroll: true });
          }}
        >
          {action.label}
        </MenuItem>
      ))}
    </PopoverPanel>
  );
}
