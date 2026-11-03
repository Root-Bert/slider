import { useEffect, type RefObject } from 'react';
import { caretAt, onText } from './editor-dom';

/**
 * What keeps its clicks over the text: the editor's own bars and panels, menus and dialogs, and
 * the handles and border of a frame moved by its edges (the typed element's own).
 */
const CONTROLS =
  '[data-live-toolbar], [role="dialog"], [role="menu"], [role="listbox"], [data-edges-only]';

/**
 * A click on a character of the text typed in reaches it, whatever lies over it on the stage – a
 * neighbour's frame, a layer around the slide, a box raised under the pointer. A text turned or
 * tilted in depth reaches past its own box, over things drawn above it there; without this, its
 * characters there could be seen but not clicked. The caret goes where it was clicked; what lay
 * over it hears nothing of the click.
 */
export function useClicksReachText(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const node = root.current;
      if (!node || event.button !== 0 || !(event.target instanceof Element)) return;
      // Reaching it anyway: the browser's own caret and selection.
      if (node.contains(event.target)) return;
      const stack = document.elementsFromPoint(event.clientX, event.clientY);
      const at = stack.findIndex((element) => node.contains(element));
      if (at <= 0) return;
      const over = stack.slice(0, at).filter((element) => element instanceof HTMLElement);
      if (over.some((element) => element.closest(CONTROLS))) return;
      const point = { x: event.clientX, y: event.clientY };
      // For the moment the caret is found, what lies over the text lets the pointer through.
      const kept = over.map((element) => [element, element.style.pointerEvents] as const);
      for (const [element] of kept) element.style.pointerEvents = 'none';
      try {
        if (!onText(node, point)) return;
        event.preventDefault();
        event.stopPropagation();
        node.focus({ preventScroll: true });
        caretAt(node, point);
      } finally {
        for (const [element, value] of kept) element.style.pointerEvents = value;
      }
      // Its click is no click on what lay over it (a frame would pick its element).
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 500);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [root]);
}
