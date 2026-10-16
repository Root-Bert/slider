/** Box mode is a per-browser preference, like the split. */
const STORAGE_KEY = 'slider.boxMode';

/** On by default: clicking a slide comments on the PowerPoint box under the pointer. */
export function loadStoredBoxMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function storeBoxMode(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the mode just isn't remembered.
  }
}
