import { useEffect, useRef } from 'react';

/** What a region in the top layer needs instead of a popover's own look (centred, bordered). */
export const TOP_LAYER_CLASS = 'top-auto m-0 w-full overflow-visible border-0 bg-transparent py-0';

/**
 * Keeps an element (give it `popover="manual"`) in the browser's top layer and raises it anew
 * whenever `key` changes: a message that comes while a dialog is open shows above the dialog's
 * backdrop, not dimmed under it.
 */
export function useTopLayer<E extends HTMLElement>(key: unknown) {
  const ref = useRef<E>(null);
  useEffect(() => {
    const region = ref.current;
    // Browsers without popovers (and the tests' DOM) keep it on its z layer.
    if (!region?.showPopover) return;
    if (region.matches(':popover-open')) region.hidePopover();
    region.showPopover();
  }, [key]);
  return ref;
}
