import { readString, writeString } from '../storage';

/** Box mode is a per-browser preference, like the split. */
const STORAGE_KEY = 'slider.boxMode';

/** On by default: clicking a slide comments on the PowerPoint box under the pointer. */
export function loadStoredBoxMode(): boolean {
  // Unreadable storage reads as `null`: on.
  return readString(STORAGE_KEY) !== 'off';
}

/** Private mode or blocked storage: the mode just isn't remembered. */
export function storeBoxMode(on: boolean): void {
  writeString(STORAGE_KEY, on ? 'on' : 'off');
}
