import { useSyncExternalStore } from 'react';
import { createStoredStore } from './storage';

/** The account menu's choice: a fixed theme, or the system's. */
export type ThemePreference = 'light' | 'system' | 'dark';

const STORAGE_KEY = 'slider.theme';
const PREFERENCES: readonly ThemePreference[] = ['light', 'system', 'dark'];
/** `--color-canvas` per theme, for the browser's chrome (`theme-color`). */
const CANVAS = { dark: '#000000', light: '#f4f4f5' } as const;

const store = createStoredStore<ThemePreference>({
  key: STORAGE_KEY,
  parse: (value) =>
    PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system',
  // Nothing chosen: the system's light or dark.
  fallback: 'system',
  crossTab: true,
});

const systemLight = () => window.matchMedia('(prefers-color-scheme: light)');

function apply() {
  const preference = store.getSnapshot();
  const theme =
    preference === 'light' || (preference === 'system' && systemLight().matches) ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CANVAS[theme]);
}

/**
 * Keeps `<html data-theme>` on the chosen theme – following the system while "System" is chosen,
 * and other tabs' choices. `public/theme-init.js` sets it once before the first paint.
 */
export function installTheme() {
  apply();
  store.subscribe(apply);
  systemLight().addEventListener('change', apply);
}

/** The theme choice and its setter. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  return [useSyncExternalStore(store.subscribe, store.getSnapshot), store.set];
}
