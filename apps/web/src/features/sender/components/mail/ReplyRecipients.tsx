import { useId, type ReactNode } from 'react';
import type { MailPerson } from '@slider/shared';
import type { MailRecipients } from '@/lib/api';
import { cn, Icon } from '@/ui';
import { AddressField } from './AddressField';

const named = (addresses: string[], names: ReadonlyMap<string, string>) =>
  addresses.map((one) => names.get(one.toLowerCase()) || one).join(', ');

/**
 * Whom a reply goes to, over its field: one line („An Eva · Cc Tom, Mia“) – clicked, the fields
 * An, Cc, Bcc open to add or take away, as in a new mail. `aside` stands at the line's end
 * („Allen antworten“).
 */
export function ReplyRecipients({
  recipients,
  onChange,
  open,
  onOpenChange,
  names,
  aside,
  onKeyDown,
  book,
}: {
  recipients: MailRecipients;
  onChange: (recipients: MailRecipients) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  names: ReadonlyMap<string, string>;
  aside?: ReactNode;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Whom one wrote with, offered in the fields. */
  book?: readonly MailPerson[];
}) {
  const ids = { to: useId(), cc: useId(), bcc: useId() };
  if (!open) {
    const { to, cc, bcc } = recipients;
    return (
      <div className="flex min-w-0 items-center gap-3 px-1">
        <button
          type="button"
          aria-expanded={false}
          title="Empfänger bearbeiten"
          onClick={() => onOpenChange(true)}
          className="group flex h-7 min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-fg-muted hover:text-fg"
        >
          <Icon name="reply" size={16} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate">
            {to.length > 0 ? (
              <>
                <span className="text-fg-subtle">An </span>
                {named(to, names)}
              </>
            ) : (
              <span className="text-danger">An niemanden</span>
            )}
            {cc.length > 0 && (
              <>
                <span className="text-fg-subtle"> · Cc </span>
                {named(cc, names)}
              </>
            )}
            {bcc.length > 0 && (
              <>
                <span className="text-fg-subtle"> · Bcc </span>
                {named(bcc, names)}
              </>
            )}
          </span>
          <Icon
            name="expandMore"
            size={16}
            className="shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
        {aside}
      </div>
    );
  }
  const row = (key: keyof MailRecipients, label: string, last = false) => (
    <div
      className={cn('flex min-h-10 items-start gap-3 px-3', !last && 'border-b border-hairline')}
    >
      <label htmlFor={ids[key]} className="w-8 shrink-0 pt-2.5 text-body text-fg-subtle">
        {label}
      </label>
      <AddressField
        id={ids[key]}
        label={label}
        value={recipients[key]}
        onChange={(addresses) => onChange({ ...recipients, [key]: addresses })}
        names={names}
        book={book}
        listAbove
        autoFocus={key === 'to'}
        onKeyDown={onKeyDown}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-3 px-1">
        <button
          type="button"
          aria-expanded
          onClick={() => onOpenChange(false)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-fg-muted hover:text-fg"
        >
          <Icon name="reply" size={16} className="shrink-0 text-fg-subtle" />
          Empfänger
          <Icon name="expandLess" size={16} className="shrink-0 text-fg-subtle" />
        </button>
        {aside}
      </div>
      <div className="glass relative rounded-panel shadow-none! after:pointer-events-none after:absolute after:inset-0 after:rounded-panel after:ring-hairline">
        {row('to', 'An')}
        {row('cc', 'Cc')}
        {row('bcc', 'Bcc', true)}
      </div>
    </div>
  );
}
