import { useEffect, useRef, useState } from 'react';
import { MAX_MAILBOX_LABEL, mailboxDefaultLabel, type MailAccount } from '@slider/shared';
import { useRenameMailAccount } from '@/lib/api';
import { cn } from '@/ui';
import { useSender } from '../../hooks/useSender';

/**
 * „Umbenennen“ a mailbox in place, as a folder's name in Cloud: the name itself – a title tab on
 * the mail page, its row under „Postfächer“ – turns into a field. Enter or leaving it saves,
 * Escape cancels; emptied it is called by its default again (Google, Microsoft, the domain), shown
 * as the hint. Every list shows the new name at once; a refusal toasts and the old one is back.
 */
export function MailboxNameInput({
  account,
  shown,
  onDone,
  className,
}: {
  account: MailAccount;
  /** The name it shows now (its own, or its default – maybe its address beside a namesake). */
  shown: string;
  onDone: () => void;
  className?: string;
}) {
  const ui = useSender();
  const rename = useRenameMailAccount(ui.workspace.id);
  const [name, setName] = useState(account.label ?? shown);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows must not save twice.
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = () => {
    settled.current = true;
    onDone();
  };

  const save = () => {
    if (settled.current) return;
    const trimmed = name.trim();
    if (trimmed === (account.label ?? '') || (!account.label && trimmed === shown)) return finish();
    rename.mutate(
      { id: account.id, label: trimmed },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
    finish();
  };

  return (
    <input
      ref={ref}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      // The browser's own menu (paste …) instead of the mailbox's.
      onContextMenu={(event) => event.stopPropagation()}
      maxLength={MAX_MAILBOX_LABEL}
      placeholder={mailboxDefaultLabel(account)}
      aria-label="Name des Postfachs"
      className={cn(
        '-mx-1 min-w-0 rounded-badge bg-surface-1 px-1 text-fg [font:inherit]',
        'ring-2 ring-focus outline-none',
        className,
      )}
    />
  );
}
