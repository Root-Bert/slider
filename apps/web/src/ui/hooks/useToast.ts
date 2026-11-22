import { useCallback, useEffect, useState } from 'react';

export type ToastTone = 'neutral' | 'danger';

/** One thing to do about it, e.g. „Rückgängig“ (as Cloud's toast). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  action?: ToastAction;
}

const VISIBLE_MS = 4000;
/** Longer with something to click: nobody reaches a button in four seconds by keyboard. */
const WITH_ACTION_MS = 8000;

/** Short-lived status message for background actions (archive, delete) – rendered by `<Toast>`. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.action ? WITH_ACTION_MS : VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Stable, so it can sit in a context without re-rendering consumers.
  const show = useCallback(
    (text: string, tone: ToastTone = 'neutral', action?: ToastAction) =>
      setToast({ id: Date.now(), text, tone, ...(action ? { action } : {}) }),
    [],
  );

  return [toast, show] as const;
}

export type ShowToast = ReturnType<typeof useToast>[1];
