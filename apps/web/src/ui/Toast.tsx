import { cn } from './cn';
import { Icon } from './Icon';
import type { ToastMessage } from './useToast';

/** Bottom-centred status line. The live region stays mounted so screen readers announce changes. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      {toast && (
        <p
          key={toast.id}
          className={cn(
            'glass-elevated flex animate-pop-in items-center gap-2 rounded-panel px-4 py-2.5 text-[13px]',
            toast.tone === 'danger' ? 'text-danger' : 'text-fg',
          )}
        >
          <Icon name={toast.tone === 'danger' ? 'error' : 'checkCircle'} size={18} />
          {toast.text}
        </p>
      )}
    </div>
  );
}
