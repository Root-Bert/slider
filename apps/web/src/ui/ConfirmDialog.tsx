import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import type { IconName } from './Icon';

export interface ConfirmDialogProps {
  /** Defaults to `true` for dialogs that are mounted only while they show. */
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** The action, e.g. "Endgültig löschen". */
  confirmLabel: string;
  confirmIcon?: IconName;
  /** `danger` (default) for destructive actions, `primary` for e.g. "Speichern". */
  tone?: 'danger' | 'primary';
  /** Runs on the confirm button; optional when `form` submits instead. */
  onConfirm?: () => void;
  /**
   * Id of a `<form>` in `children`: the confirm button becomes its submit button, so Enter in a
   * field confirms too (rename dialogs). Handle the action in the form's `onSubmit`.
   */
  form?: string;
  /** The action is running: spinner on the confirm button, which is disabled meanwhile. */
  pending?: boolean;
  /** Disabled without a spinner (e.g. while another action of the dialog runs). */
  confirmDisabled?: boolean;
  /** Why the action failed, shown as an alert below the content. */
  error?: ReactNode;
  /** Further buttons between "Abbrechen" and the confirm button. */
  extraActions?: ReactNode;
  cancelLabel?: string;
  /** Extra content between header and footer (a list, a select, a type-to-confirm field). */
  children?: ReactNode;
  className?: string;
}

/** `Dialog` with the standard footer: ghost "Abbrechen" and a danger (or primary) action. */
export function ConfirmDialog({
  open = true,
  onClose,
  title,
  description,
  confirmLabel,
  confirmIcon,
  tone = 'danger',
  onConfirm,
  form,
  pending = false,
  confirmDisabled = false,
  error,
  extraActions,
  cancelLabel = 'Abbrechen',
  children,
  className,
}: ConfirmDialogProps) {
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className={className}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          {extraActions}
          <Button
            {...(form !== undefined && { type: 'submit' as const, form })}
            variant={tone}
            icon={confirmIcon}
            loading={pending}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {hasError && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
