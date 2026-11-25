import { useEffect, useEffectEvent } from 'react';
import { isSearchKey } from '@/lib/keyboard';

/** A search's key, everywhere in the apps: ⌘F the page's own field, ⇧⌘F the side bar's. */
export function useSearchShortcut(
  onTrigger: () => void,
  enabled = true,
  search: 'page' | 'main' = 'page',
) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isSearchKey(event, search)) return;
    // Over an open dialog nothing behind it is searched: its question comes first.
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    onTrigger();
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
