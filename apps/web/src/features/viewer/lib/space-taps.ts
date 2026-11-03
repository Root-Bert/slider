import { isTypingTarget } from '@/lib/dom';

/** Space twice within this long is Space twice. */
const DOUBLE_SPACE_MS = 400;
/** A tap of Space is shorter than this; held longer it is the hand (`useHandPan`). */
const TAP_MS = 250;

/** Elements whose Space is their own (a button presses, a field types). */
export const OWN_SPACE = 'button, input, select, textarea, a, dialog, [contenteditable]';

/**
 * Tells Space tapped twice from Space held (the hand) – fed every keydown and keyup of the
 * window; true on the keyup that ends the second tap. Not while typing, nor on a control Space
 * would press. One tracker per use: each keeps its own taps.
 */
export function spaceTaps(): (event: KeyboardEvent) => boolean {
  let lastTap = -Infinity;
  let down = -Infinity;
  return (event) => {
    if (event.key !== ' ' || event.repeat) return false;
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target))
      return false;
    if (event.target instanceof Element && event.target.closest(OWN_SPACE)) return false;
    event.preventDefault();
    const now = performance.now();
    if (event.type === 'keydown') {
      down = now;
      return false;
    }
    // Held (the hand moving the view): no tap.
    if (now - down > TAP_MS) {
      lastTap = -Infinity;
      return false;
    }
    if (now - lastTap < DOUBLE_SPACE_MS) {
      lastTap = -Infinity;
      return true;
    }
    lastTap = now;
    return false;
  };
}
