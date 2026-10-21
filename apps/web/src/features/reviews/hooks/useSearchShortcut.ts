import { useEffect, useEffectEvent } from 'react';
import { isModKey } from '@/lib/keyboard';

/** ⌘K (macOS) / Ctrl K (elsewhere) – the conventional "focus search" shortcut. */
export function useSearchShortcut(onTrigger: () => void, enabled = true) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'k' || !isModKey(event) || event.altKey) return;
    event.preventDefault();
    onTrigger();
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
