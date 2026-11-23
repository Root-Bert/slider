import { useEffect, useEffectEvent } from 'react';
import { isModKey } from '@/lib/keyboard';

/**
 * A search's key, everywhere in the apps (the user's call): ⌘F (macOS) / Ctrl F the side bar's –
 * the whole app's –, ⌘K / Ctrl K the page's own field.
 */
export function useSearchShortcut(onTrigger: () => void, enabled = true, key: 'f' | 'k' = 'f') {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== key || !isModKey(event) || event.altKey) return;
    event.preventDefault();
    onTrigger();
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
