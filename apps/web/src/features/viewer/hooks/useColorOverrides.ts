import { useSyncExternalStore } from 'react';
import {
  colorOverridesStore,
  NO_COLOR_OVERRIDES,
  type ColorOverrides,
} from '../lib/color-overrides';

/** Colours the viewer picked for other people (this browser only). */
export function useColorOverrides(): ColorOverrides {
  return useSyncExternalStore(
    colorOverridesStore.subscribe,
    colorOverridesStore.getSnapshot,
    () => NO_COLOR_OVERRIDES,
  );
}
