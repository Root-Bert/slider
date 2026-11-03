import { useEffect, useEffectEvent, type RefObject } from 'react';

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Where Tab stops in `container`, in order – not roving items (`tabindex="-1"`) or hidden parts. */
function tabStops(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0,
  );
}

/**
 * Tab / ⇧Tab go round in a floating panel once the focus is in it (a chooser, a popover, a
 * dialog): from the last control on to the first, from the first back to the last – out only by
 * picking, Esc or a click elsewhere. Between the ends Tab keeps its own order, and keys someone
 * else took first (`defaultPrevented`) stay theirs. `container` is a ref or, for a panel found by
 * its id, a getter.
 */
export function useFocusLoop(
  container: RefObject<HTMLElement | null> | (() => HTMLElement | null),
  active = true,
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const panel = typeof container === 'function' ? container() : container.current;
    const target = event.target;
    if (!panel || !(target instanceof HTMLElement) || !panel.contains(target)) return;
    const stops = tabStops(panel);
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    const edge = event.shiftKey ? first : last;
    // On the panel itself (focused to take the keys): into it, from its start or its end. On a
    // roving item (no stop of its own): round only when no stop lies beyond it that way.
    const roving = target !== panel && !stops.includes(target);
    const beyond = (stop: HTMLElement) =>
      target.compareDocumentPosition(stop) &
      (event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING);
    if (roving ? stops.some(beyond) : target !== edge && target !== panel) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  });

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [active]);
}
