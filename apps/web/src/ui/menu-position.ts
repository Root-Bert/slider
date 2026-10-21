const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * Where the open menu goes: below the trigger with its right edge on the trigger's (`end`),
 * above it when there is no room below, and always inside the viewport.
 */
export function anchoredMenuPosition(
  trigger: Pick<DOMRect, 'top' | 'bottom' | 'right'>,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const below = trigger.bottom + MENU_GAP;
  const above = trigger.top - MENU_GAP - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow || above < VIEWPORT_MARGIN ? below : above;
  const left = trigger.right - menu.width;
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(left, viewport.width - menu.width - VIEWPORT_MARGIN)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(top, viewport.height - menu.height - VIEWPORT_MARGIN)),
  };
}
