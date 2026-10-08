/** True when keyboard shortcuts must not fire because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
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
    cancel: () => {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
