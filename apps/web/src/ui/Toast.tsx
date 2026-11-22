import { useState } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';
import type { ToastMessage } from './hooks/useToast';
import { TOP_LAYER_CLASS, useTopLayer } from './hooks/useTopLayer';

/**
 * Bottom-centred status line. The live region stays mounted so screen readers announce changes.
 * It lies in the browser's top layer (a manual popover), raised anew with every message: a
 * refusal that comes while a dialog is open shows above the dialog's backdrop, not under it.
 */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  const ref = useTopLayer<HTMLDivElement>(toast?.id);
  // Its action done: gone at once, not after its time.
  const [done, setDone] = useState<number | null>(null);
  return (
    <div
      ref={ref}
      popover="manual"
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-6 z-(--z-toast) flex justify-center px-4',
        TOP_LAYER_CLASS,
      )}
    >
      {toast && toast.id !== done && (
        <p
          key={toast.id}
          className={cn(
            'glass-elevated flex animate-pop-in items-center gap-2 rounded-panel px-4 py-2.5 text-body',
            toast.action && 'py-1.5 pr-1.5',
            toast.tone === 'danger' ? 'text-danger' : 'text-fg',
          )}
        >
          <Icon name={toast.tone === 'danger' ? 'error' : 'checkCircle'} size={18} />
          {toast.text}
          {toast.action && (
            <Button
              variant="soft"
              size="sm"
              className="pointer-events-auto ml-2"
              onClick={() => {
                toast.action?.run();
                setDone(toast.id);
              }}
            >
              {toast.action.label}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
