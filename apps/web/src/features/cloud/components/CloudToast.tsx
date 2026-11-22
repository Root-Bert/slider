import { useCallback, useEffect, useState } from 'react';
import { Button, cn, Icon, TOP_LAYER_CLASS, useTopLayer } from '@/ui';

export interface CloudToastMessage {
  id: number;
  text: string;
  tone: 'neutral' | 'danger';
  /** One thing to do about it, e.g. „Rückgängig“. */
  action?: { label: string; run: () => void };
}

export type Notify = (
  text: string,
  tone?: CloudToastMessage['tone'],
  action?: CloudToastMessage['action'],
) => void;

/** Longer with something to click: nobody reaches a button in four seconds by keyboard. */
const VISIBLE_MS = 4000;
const WITH_ACTION_MS = 8000;

/** The kit's toast with one action beside the text – deleting is undone from here. */
export function useCloudToast() {
  const [toast, setToast] = useState<CloudToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.action ? WITH_ACTION_MS : VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  const notify = useCallback<Notify>(
    (text, tone = 'neutral', action) => setToast({ id: Date.now(), text, tone, action }),
    [],
  );
  return { toast, notify, dismiss: () => setToast(null) };
}

export function CloudToast({
  toast,
  onDismiss,
}: {
  toast: CloudToastMessage | null;
  onDismiss: () => void;
}) {
  // Above an open dialog too – what went wrong there is not said under its backdrop.
  const ref = useTopLayer<HTMLDivElement>(toast?.id);
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
      {toast && (
        <p
          key={toast.id}
          className={cn(
            'glass-elevated pointer-events-auto flex animate-pop-in items-center gap-2 rounded-panel py-1.5 pr-1.5 pl-4 text-body',
            toast.tone === 'danger' ? 'text-danger' : 'text-fg',
            !toast.action && 'py-2.5 pr-4',
          )}
        >
          <Icon
            name={toast.tone === 'danger' ? 'error' : 'checkCircle'}
            size={18}
            className={toast.tone === 'danger' ? undefined : 'text-success'}
          />
          {toast.text}
          {toast.action && (
            <Button
              variant="soft"
              size="sm"
              className="ml-2"
              onClick={() => {
                toast.action?.run();
                onDismiss();
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
