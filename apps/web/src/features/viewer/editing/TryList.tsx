import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn, Icon, usePopover } from '@/ui';
import { FloatingPanel } from './colors/ColorPalette';

/** Typed within this long (ms) of the last key: one name searched for. */
const TYPE_AHEAD_MS = 700;
/** ⇞ / ⇟ step this many choices. */
const PAGE = 8;

/**
 * A field's own list whose choices are tried on the text before one is taken – the font's and
 * the size's: hovered, or stepped with ↑ ↓ (⇞ ⇟, Home, End, keys typed), the text shows each at
 * once (`onTry`); ↵, Space, Tab or a click takes one, Esc, a press outside or the pointer leaving
 * the list puts the text back as it was (`onTry(null)`). The trigger spreads `triggerProps`, opens
 * with `toggleList`; `panel` is the list, as wide as the field (`wrapperRef`), right under it.
 */
export function useTryList<T>({
  items,
  value,
  label,
  onTry,
  onPick,
  onDone,
  typed,
  render,
}: {
  items: readonly T[];
  /** `null`: the text has several. */
  value: T | null;
  label: string;
  onTry: (item: T | null) => void;
  onPick: (item: T) => void;
  /** Takes the focus once the list closes (the text typed in); else the trigger keeps it. */
  onDone?: () => void;
  /** The choice the keys typed (lower case) begin. */
  typed: (item: T, text: string) => boolean;
  render: (item: T) => ReactNode;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(-1);
  /**
   * What the text had as the list opened: ticked while choices are tried on (the text shows
   * them), and where the list goes back to once the pointer leaves it.
   */
  const [from, setFrom] = useState<{ index: number; value: T | null }>({ index: -1, value });
  /** A choice was tried on and not yet taken or put back. */
  const trying = useRef(false);
  const latest = useRef(onTry);
  useLayoutEffect(() => {
    latest.current = onTry;
  });
  const { open, setOpen, triggerProps, triggerRef, wrapperRef, panelRef, panelId } = usePopover({
    hasPopup: 'listbox',
    // Tab takes the choice and goes on, like a menu's.
    loopFocus: false,
    // Closed without a pick (Esc, a press outside): the text as it was.
    onOpenChange: (isOpen) => {
      if (isOpen || !trying.current) return;
      trying.current = false;
      latest.current(null);
    },
  });

  const openList = () => {
    const index = Math.max(0, value === null ? 0 : items.indexOf(value));
    setFrom({ index, value });
    setActive(index);
    setOpen(true);
  };
  // The focus goes first: the text drawn with the choice then keeps its selection.
  const close = () => {
    setOpen(false);
    if (onDone) onDone();
    else triggerRef.current?.focus();
  };
  const toggleList = () => (open ? close() : openList());
  const pick = (item: T) => {
    const changed = trying.current || item !== value;
    trying.current = false;
    close();
    if (changed) onPick(item);
  };
  /** Keys bring the choice into view; the pointer is on it already (scrolled, it would run on). */
  const tryAt = (index: number, scroll = true) => {
    const next = Math.min(items.length - 1, Math.max(0, index));
    if (next === active && trying.current) return;
    setActive(next);
    trying.current = true;
    onTry(items[next]!);
    if (scroll) document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
  };
  const putBack = () => {
    setActive(from.index);
    if (!trying.current) return;
    trying.current = false;
    onTry(null);
  };

  // The focus in the list once open, its choice in view.
  useEffect(() => {
    if (!open) return;
    // A frame later: the panel is invisible until placed, and takes no focus till then.
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      list?.focus({ preventScroll: true });
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const keys = useRef({ text: '', at: 0 });
  const typeAhead = (key: string, now: number) => {
    const text = (now - keys.current.at < TYPE_AHEAD_MS ? keys.current.text : '') + key;
    keys.current = { text, at: now };
    const index = items.findIndex((item) => typed(item, text.toLowerCase()));
    if (index >= 0 && index !== active) tryAt(index);
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const steps: Partial<Record<string, number>> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      PageDown: active + PAGE,
      PageUp: active - PAGE,
      Home: 0,
      End: items.length - 1,
    };
    const to = steps[event.key];
    const item = active >= 0 ? items[active] : undefined;
    if (to !== undefined) tryAt(to);
    else if ((event.key === 'Enter' || event.key === ' ') && item !== undefined) pick(item);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') {
      // From the trigger, Tab's default goes on to the control after it.
      const taken = trying.current && item !== undefined;
      trying.current = false;
      setOpen(false);
      triggerRef.current?.focus();
      if (taken) onPick(item);
      return;
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeAhead(event.key, event.timeStamp);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const panel = open && (
    <FloatingPanel
      anchorRef={wrapperRef}
      panelRef={panelRef}
      panelId={panelId}
      label={label}
      flush
      matchWidth
    >
      <ul
        ref={listRef}
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onKeyDown={onListKey}
        onPointerLeave={putBack}
        className="max-h-80 overflow-y-auto p-1 outline-none"
      >
        {items.map((item, index) => (
          <li
            key={String(item)}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={item === from.value}
            onPointerEnter={() => tryAt(index, false)}
            onClick={() => pick(item)}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-2 rounded-control-sm px-2 whitespace-nowrap',
              index === active && 'bg-hover',
            )}
          >
            <Icon
              name="check"
              size={14}
              className={cn('shrink-0', item === from.value ? 'text-fg' : 'invisible')}
            />
            {render(item)}
          </li>
        ))}
      </ul>
    </FloatingPanel>
  );

  /** Opens with ↓ or ↑ on the trigger (else its own keys). */
  const onTriggerKey = (event: KeyboardEvent) => {
    if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    event.stopPropagation();
    openList();
  };

  return { open, setOpen, toggleList, triggerProps, wrapperRef, onTriggerKey, panel };
}
