import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';

/** On a row with such a menu: no text picked, no iOS link preview on a long press. */
export const ROW_MENU_CLASS = 'select-none [-webkit-touch-callout:none]';

/** Press length (ms) that opens the menu on touch – iOS Safari fires no `contextmenu`. */
const LONG_PRESS_MS = 500;
/** Finger travel (px) that turns a long press into a scroll. */
const LONG_PRESS_SLOP = 10;

/**
 * A row's menu at the pointer (`ContextMenu`), as a presentation's: a right click (Shift + right
 * click keeps the browser's own – open in a new tab), Shift+F10 or the menu key (under the row),
 * a long press on touch – which does not also open the row. Spread `props` on the row's link.
 */
export function useRowMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  // A touch press: its timer, where it started, whether it opened the menu already.
  const press = useRef<{ timer: number; x: number; y: number; opened: boolean } | null>(null);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
  };
  useEffect(() => endPress, []);
  const props = {
    'aria-keyshortcuts': 'Shift+F10',
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (event.shiftKey) return;
      event.preventDefault();
      // Android's long press: ours may have opened it already – keep it where it is.
      if (press.current?.opened) return;
      setAt({ x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      // macOS has no menu key and fires no `contextmenu` for Shift+F10: both here (prevented, so
      // Windows sends no `contextmenu` on top).
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      setAt({ x: box.left + 12, y: box.bottom });
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      endPress();
      press.current = null;
      if (event.pointerType === 'mouse') return;
      const current = {
        x: event.clientX,
        y: event.clientY,
        opened: false,
        timer: window.setTimeout(() => {
          current.opened = true;
          setAt({ x: current.x, y: current.y });
        }, LONG_PRESS_MS),
      };
      press.current = current;
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || current.opened) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP) {
        endPress();
        press.current = null;
      }
    },
    onPointerUp: () => {
      endPress();
      if (press.current && !press.current.opened) press.current = null;
    },
    onPointerCancel: () => {
      endPress();
      press.current = null;
    },
    // The click that ends a long press: the menu is open, the row stays where it is.
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!press.current?.opened) return;
      press.current = null;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  return { at, close, props };
}
