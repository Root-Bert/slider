import { useEffect, useState } from 'react';

export type ToastTone = 'neutral' | 'danger';

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const VISIBLE_MS = 4000;

/** Short-lived status message for background actions (archive, delete) – rendered by `<Toast>`. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const show = (text: string, tone: ToastTone = 'neutral') =>
    setToast({ id: Date.now(), text, tone });

  return [toast, show] as const;
}

export type ShowToast = ReturnType<typeof useToast>[1];
