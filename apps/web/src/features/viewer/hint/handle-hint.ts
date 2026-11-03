import { useSyncExternalStore } from 'react';

/*
 * A short hint the split handle under the track turns into (`HandleHint`) – said by whatever the
 * pointer is on (⇧ over an element's turning handle where it cannot tilt), gone once it is not.
 */

let current: string | null = null;
const listeners = new Set<() => void>();

/** Shows `text` out of the handle; `null` lets it go back. */
export function setHandleHint(text: string | null): void {
  if (text === current) return;
  current = text;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useHandleHint = (): string | null => useSyncExternalStore(subscribe, () => current);
