/** True when keyboard shortcuts must not fire because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Scrolls `container` horizontally so `child` is visible – unlike `scrollIntoView` this never
 * moves any other scroll container (e.g. the page).
 */
export function scrollChildIntoView(
  container: HTMLElement,
  child: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
) {
  const box = container.getBoundingClientRect();
  const item = child.getBoundingClientRect();
  const margin = 16;
  if (item.left < box.left + margin) {
    container.scrollBy({ left: item.left - box.left - margin, behavior });
  } else if (item.right > box.right - margin) {
    container.scrollBy({ left: item.right - box.right + margin, behavior });
  }
}

/** Calls `callback` at most once per animation frame; returns a cancel function. */
export function rafThrottle(callback: () => void): { schedule: () => void; cancel: () => void } {
  let frame = 0;
  return {
    schedule: () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        callback();
      });
    },
    cancel: () => cancelAnimationFrame(frame),
  };
}

/** Which edges of a horizontal scroller hide content (1px tolerance for fractional layouts). */
export function overflowEdges(scrollLeft: number, scrollWidth: number, clientWidth: number) {
  return { start: scrollLeft > 1, end: scrollLeft < scrollWidth - clientWidth - 1 };
}
