import { useState } from 'react';
import { ConfirmDialog, type ShowToast } from '@/ui';

/** A change the admin confirms first: the dialog's copy, the toast once done, and the call. */
export interface ConfirmedAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  /** The toast once it is done. */
  done: string;
  run: (onSuccess: () => void) => void;
}

/** The mutations an action may run: the dialog shows them busy or failed, and resets them. */
interface Running {
  isPending: boolean;
  error: { message: string } | null;
  reset: () => void;
}

/** Asks before a change to a row – `ask(action)` opens the dialog, `dialog` renders it. */
export function useConfirmedAction(onNotify: ShowToast, mutations: readonly Running[]) {
  const [action, setAction] = useState<ConfirmedAction | null>(null);
  const close = () => {
    setAction(null);
    for (const mutation of mutations) mutation.reset();
  };
  const dialog = action && (
    <ConfirmDialog
      onClose={close}
      title={action.title}
      description={action.description}
      confirmLabel={action.confirmLabel}
      tone={action.tone}
      pending={mutations.some((mutation) => mutation.isPending)}
      error={mutations.find((mutation) => mutation.error)?.error?.message}
      onConfirm={() =>
        action.run(() => {
          onNotify(action.done);
          close();
        })
      }
    />
  );
  return { ask: setAction, dialog };
}
