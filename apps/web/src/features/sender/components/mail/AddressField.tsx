import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { MailPerson } from '@slider/shared';
import { cn, Icon } from '@/ui';
import { addressesFitting, addressesIn, MAIL_ADDRESS } from '../../lib/mail-address';

/** Without twice the same address (as typed, case aside). */
const withoutTwice = (addresses: string[]) => {
  const seen = new Set<string>();
  return addresses.filter((one) => {
    const key = one.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Whom a mail goes to, as chips in one line that wraps: typed and closed by Enter, comma, space or
 * leaving the field (pasted: all addresses at once); ⌫ in the empty field takes the last back, ✕
 * one. A chip shows the name the conversation knows the address by; one that is no address is red.
 * Typing offers whom one wrote with (`book`), as the @ list over a composer: ↑/↓ pick, Enter or
 * Tab takes the picked one, Esc closes the list.
 */
export function AddressField({
  id,
  label,
  value,
  onChange,
  names,
  placeholder,
  invalid,
  describedBy,
  autoFocus,
  inputRef,
  onKeyDown,
  className,
  book,
  listAbove = false,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (addresses: string[]) => void;
  /** Known names by address (lower case). */
  names?: ReadonlyMap<string, string>;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Keys the field leaves alone (⌘↵ sends, Esc). */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  /** Whom one wrote with (`useMailAddressBook`), offered as one types. */
  book?: readonly MailPerson[];
  /** At the foot of a column (a reply's fields): the list opens upwards. */
  listAbove?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const listId = useId();
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const fitting = dismissed ? [] : addressesFitting(book ?? [], typed, value);
  const shownPick = Math.min(picked, Math.max(fitting.length - 1, 0));
  const nameOf = (address: string) =>
    names?.get(address.toLowerCase()) ||
    book?.find((one) => one.address.toLowerCase() === address.toLowerCase())?.name ||
    '';
  const take = (person: MailPerson) => {
    setTyped('');
    setPicked(0);
    onChange(withoutTwice([...value, person.address]));
  };
  const close = (more = typed) => {
    const added = addressesIn(more);
    setTyped('');
    if (added.length > 0) onChange(withoutTwice([...value, ...added]));
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const text = event.currentTarget.value;
    if (fitting.length > 0) {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        event.preventDefault();
        setPicked((shownPick + step + fitting.length) % fitting.length);
        return;
      }
      if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
        event.preventDefault();
        take(fitting[shownPick]!);
        return;
      }
      if (event.key === 'Escape') {
        // The list goes; the field (and the mail) stay.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    if (
      (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && text.trim()) ||
      event.key === ',' ||
      event.key === ';' ||
      // A space ends an address – not a name being looked up („Eva B…“).
      (event.key === ' ' && text.trim() && (fitting.length === 0 || text.includes('@')))
    ) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab' && text.trim()) close();
    // ⌘↵ with an address half typed: it goes along (`onChange` first, then the send).
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) close();
    // Enter alone never sends the form a field stands in.
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) event.preventDefault();
    if (event.key === 'Backspace' && !text && value.length > 0) {
      event.preventDefault();
      const last = value.at(-1) ?? '';
      onChange(value.slice(0, -1));
      // The last one back in the field, to be mended – as mail apps do.
      setTyped(last);
      return;
    }
    onKeyDown?.(event);
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(pasted.trim())) return;
    event.preventDefault();
    close(`${typed} ${pasted}`);
  };
  return (
    <div
      className={cn('relative flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5', className)}
    >
      {value.map((address, index) => {
        const name = nameOf(address);
        const wrong = !MAIL_ADDRESS.test(address);
        return (
          <span
            key={`${address}:${index}`}
            title={name ? `${name} <${address}>` : address}
            className={cn(
              'inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-chip pr-1 pl-2 text-body',
              wrong ? 'bg-danger/12 text-danger' : 'bg-surface-2 text-fg',
            )}
          >
            <span className="truncate">{name || address}</span>
            <button
              type="button"
              aria-label={`${name || address} entfernen`}
              onClick={() => onChange(value.filter((_, at) => at !== index))}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg"
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        id={id}
        aria-label={label}
        type="text"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        role="combobox"
        aria-expanded={fitting.length > 0}
        aria-controls={fitting.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={fitting.length > 0 ? `${listId}-${shownPick}` : undefined}
        value={typed}
        maxLength={1000}
        onChange={(event) => {
          setTyped(event.target.value);
          setPicked(0);
          setDismissed(false);
        }}
        onKeyDown={onKey}
        onPaste={onPaste}
        onBlur={() => close()}
        className="h-7 min-w-24 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
      />
      {fitting.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Adressen"
          data-popover-panel=""
          className={cn(
            'glass-elevated absolute left-0 z-(--z-raised) flex w-[min(360px,100%)] flex-col gap-0.5 rounded-control p-1.5',
            listAbove ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {fitting.map((person, index) => (
            <li
              key={person.address}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === shownPick}
              onPointerDown={(event) => {
                // The field keeps the focus (no blur closing what is typed).
                event.preventDefault();
                take(person);
              }}
              onPointerEnter={() => setPicked(index)}
              className={cn(
                'flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-chip px-2 text-sm',
                index === shownPick ? 'bg-selected text-fg' : 'text-fg-muted',
              )}
            >
              <span className="min-w-0 truncate">{person.name || person.address}</span>
              {person.name && (
                <span className="min-w-0 shrink truncate text-xs text-fg-subtle">
                  {person.address}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
