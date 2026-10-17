import { useEffect } from 'react';

/**
 * Unsent work that leaving the viewer would throw away: a comment being written, a recording or
 * sketch in a dialog, an upload running. Each piece holds a token while it has something; the
 * leave guard (`LeaveGuard`) asks before the review is closed and the browser before the tab is.
 */
const holds = new Set<symbol>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const unsavedWork = {
  has: (): boolean => holds.size > 0,
  /** Registers a piece of unsent work; the returned function releases it. */
  hold(): () => void {
    const token = Symbol('unsaved-work');
    holds.add(token);
    emit();
    return () => {
      if (holds.delete(token)) emit();
    };
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Holds unsent work while `active` (and the component is mounted). */
export function useHoldUnsavedWork(active: boolean) {
  useEffect(() => (active ? unsavedWork.hold() : undefined), [active]);
}
