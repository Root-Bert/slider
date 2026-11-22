import { useEffect, useEffectEvent } from 'react';
import { isModKey } from '@/lib/keyboard';

/** ⌘F (macOS) / Ctrl F (elsewhere) – search, everywhere in the apps (the user's call). */
export function useSearchShortcut(onTrigger: () => void, enabled = true) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'f' || !isModKey(event) || event.altKey) return;
    event.preventDefault();
    onTrigger();
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
