import { useEffect, useState } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

/** How long the armed delete button waits for its second click. */
const ARMED_MS = 3000;

/**
 * Deleting takes two clicks: the first turns the button red and wide („Löschen“), the second
 * deletes. Left alone it goes back after a moment. The element panel's and the comment composer's
 * trash – one behaviour everywhere. `label`: what it deletes, for screen readers („Entwurf
 * löschen“).
 */
export function DeleteButton({
  disabled = false,
  onDelete,
  label = 'Löschen',
  tabIndex,
}: {
  disabled?: boolean;
  onDelete: () => void;
  label?: string;
  tabIndex?: number;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      aria-label={armed ? `Wirklich: ${label}` : label}
      title={armed ? 'Noch einmal klicken zum Löschen' : 'Löschen'}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={() => {
        if (armed) onDelete();
        else setArmed(true);
      }}
      // Armed it is the comment dialog's „Löschen“ (Button `danger`, `sm`).
      className={cn(
        'flex h-8 shrink-0 items-center overflow-hidden rounded-control-sm text-body font-medium transition-[background-color,color,padding] duration-200 disabled:pointer-events-none disabled:opacity-40',
        armed
          ? 'bg-danger/15 px-3 text-danger hover:bg-danger/25'
          : 'px-[7px] text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <Icon name="delete" size={18} />
      <span
        className={cn(
          'whitespace-nowrap transition-[max-width,opacity,margin] duration-200',
          armed ? 'ml-1.5 max-w-20 opacity-100' : 'max-w-0 opacity-0',
        )}
      >
        Löschen
      </span>
    </button>
  );
}
