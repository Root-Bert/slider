import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MAX_MAIL_TEXT, type MailUpload } from '@slider/shared';
import {
  useMailAccounts,
  useMailAddressBook,
  useMailThread,
  useSendMail,
  useTakeBackMail,
} from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import {
  draftFor,
  draftKeys,
  dropDraft,
  setDraft,
  useDrafts,
  type DraftTarget,
} from '@/lib/drafts';
import { isModEnter } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import {
  AutosizeTextarea,
  ButtonLink,
  Button,
  cn,
  EmptyState,
  Icon,
  IconButton,
  Kbd,
  ReturnKey,
  Select,
} from '@/ui';
import { useMailListLook } from '../../hooks/useMailListLook';
import { useMailUploads } from '../../hooks/useMailUploads';
import { useMailPane, useMailView } from '../../hooks/useMailView';
import { useSender } from '../../hooks/useSender';
import { NEW_MAIL } from '../../lib/mail';
import { addressesIn, MAIL_ADDRESS, whenItGoes } from '../../lib/mail-address';
import { takeHandedFiles } from '../../lib/mail-handoff';
import { MAIL_SUBJECT, PAGE_HEADER } from '../../lib/title';
import { MenuButton } from '../MenuButton';
import { AddressField } from './AddressField';
import { MailUploads } from './MailUploads';

interface Addresses {
  to: string[];
  cc: string[];
  bcc: string[];
}

/** What keeps a mail from going: none to send to, an address that is none, no words. */
function mailRefusal(
  { to, cc, bcc }: Addresses,
  text: string,
): { field: 'to' | 'text'; text: string } | null {
  if (to.length === 0) return { field: 'to', text: 'Gib an, an wen sie geht.' };
  const wrong = [...to, ...cc, ...bcc].find((one) => !MAIL_ADDRESS.test(one));
  if (wrong) return { field: 'to', text: `„${wrong}“ ist keine E-Mail-Adresse.` };
  if (Math.max(to.length, cc.length, bcc.length) > 50)
    return { field: 'to', text: 'An höchstens 50 Adressen auf einmal.' };
  if (!text.trim()) return { field: 'text', text: 'Schreib etwas.' };
  return null;
}

const joined = (addresses: string[]) => addresses.join(', ');

/** „Neue Mail“ in the mail page's head: the form in the pane where an opened mail stands. */
export function NewMailButton({ className }: { className?: string }) {
  const ui = useSender();
  const { search } = useLocation();
  return (
    <ButtonLink
      to={`${ui.mailThreadPath(NEW_MAIL)}${search}`}
      variant="secondary"
      icon="add"
      // As high and round as the glass pills beside it (folders, „Ungelesen“).
      size="toolbar"
      className={className}
    >
      <span className="max-sm:sr-only">Neue Mail</span>
    </ButtonLink>
  );
}

/** One line of the form: its word on the left, the field filling the rest. */
function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-start gap-3 border-b border-hairline px-4">
      <label htmlFor={htmlFor} className="w-14 shrink-0 pt-3 text-body text-fg-subtle">
        {label}
      </label>
      <div className="flex min-h-11 min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

const FIELD =
  'h-11 w-full min-w-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle';

/**
 * A new mail, written in the page where an opened one stands (beside the list, or as the page):
 * from which mailbox (the list's, picked where there are several), to whom, its subject, its
 * words. ⌘↵ or „Senden“ sends – at once said so, closed; refused, it comes back with the reason.
 * What is typed is the workspace's one draft of a new mail (`mail-new:<workspace>`, „Entwürfe“),
 * on every device.
 */
export function MailCompose() {
  const ui = useSender();
  const navigate = useNavigate();
  const view = useMailView();
  const pane = useMailPane();
  const { search } = useLocation();
  const workspaceId = ui.workspace.id;
  const accounts = useMailAccounts(workspaceId).data;
  const book = useMailAddressBook(workspaceId).data;
  const send = useSendMail(workspaceId);
  const takeBack = useTakeBackMail(workspaceId);
  const [look] = useMailListLook();
  const key = draftKeys.newMail(workspaceId);
  const kept = draftFor(key);
  const keptTarget = kept?.target?.kind === 'mail-new' ? kept.target : null;
  const [to, setToState] = useState(() => addressesIn(keptTarget?.to ?? ''));
  const [cc, setCcState] = useState(() => addressesIn(keptTarget?.cc ?? ''));
  const [bcc, setBccState] = useState(() => addressesIn(keptTarget?.bcc ?? ''));
  // Passed on: that mail's attachments go along – shown under the subject, droppable.
  const [forward, setForward] = useState(keptTarget?.forward ?? null);
  const forwarded = useMailThread(workspaceId, forward?.threadId ?? '').data?.messages.find(
    (message) => message.id === forward?.messageId,
  );
  // Cc and Bcc open where one asked for them, or where the draft has some.
  const [copies, setCopies] = useState(() => !!(keptTarget?.cc || keptTarget?.bcc));
  // The fields as they are this moment – what ⌘↵ with a half-typed address sends.
  const latest = useRef<Addresses>({ to, cc, bcc });
  useEffect(() => {
    latest.current = { to, cc, bcc };
  }, [to, cc, bcc]);
  const [subject, setSubject] = useState(keptTarget?.subject ?? '');
  const [text, setText] = useState(kept?.text ?? '');
  const [picked, setPicked] = useState(keptTarget?.accountId ?? '');
  const [refusal, setRefusal] = useState<{ field: 'to' | 'text'; text: string } | null>(null);
  // The mailbox: the one picked for this mail, else the list's tab.
  const from =
    accounts?.find((each) => each.id === picked) ?? view.account ?? accounts?.[0] ?? null;
  const ids = {
    from: useId(),
    to: useId(),
    cc: useId(),
    bcc: useId(),
    subject: useId(),
    error: useId(),
  };
  const toRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  interface Fields {
    accountId: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
  }
  // The files put on it, as the draft keeps them now.
  const keptUploads = (): MailUpload[] => {
    const target = draftFor(key)?.target;
    return target?.kind === 'mail-new' ? (target.uploads ?? []) : [];
  };
  const targetOf = (fields: Fields, along = forward, files = keptUploads()): DraftTarget => ({
    kind: 'mail-new',
    workspaceId,
    ...fields,
    forward: along,
    uploads: files,
  });
  const keep = (
    next: Partial<Fields & { text: string }>,
    along = forward,
    files = keptUploads(),
  ) => {
    const fields = {
      accountId: next.accountId ?? picked,
      to: next.to ?? joined(latest.current.to),
      cc: next.cc ?? joined(latest.current.cc),
      bcc: next.bcc ?? joined(latest.current.bcc),
      subject: next.subject ?? subject,
    };
    setDraft(key, next.text ?? text, targetOf(fields, along, files));
  };
  const setAddresses = (field: keyof Addresses, addresses: string[]) => {
    latest.current = { ...latest.current, [field]: addresses };
    ({ to: setToState, cc: setCcState, bcc: setBccState })[field](addresses);
    if (field === 'to' && refusal?.field === 'to') setRefusal(null);
    keep({ [field]: joined(addresses) });
  };

  // Written on another device or tab: in the form, unless one typed on here – its „Von“ too.
  const stored = useDrafts()[key];
  const storedTarget = stored?.target?.kind === 'mail-new' ? stored.target : null;
  // Files put on it (picked, dropped, pasted): up at once, kept with the draft.
  const uploads = storedTarget?.uploads ?? [];
  const files = useMailUploads({
    accountId: from?.id ?? '',
    uploads,
    onChange: (next) => keep({}, forward, next),
    notify: ui.notify,
  });
  // Files handed from Cloud („Per Mail senden“): on as they arrive, once the mailbox is known.
  const addFiles = useRef(files.add);
  useEffect(() => {
    addFiles.current = files.add;
  });
  const fromId = from?.id;
  const notify = ui.notify;
  useEffect(() => {
    if (!fromId) return;
    for (const file of takeHandedFiles()) {
      file.then(
        (one) => addFiles.current([one]),
        (error: unknown) => notify(error instanceof Error ? error.message : 'Fehler', 'danger'),
      );
    }
  }, [fromId, notify]);
  const [dropping, setDropping] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const storedFields = JSON.stringify([
    storedTarget?.accountId ?? '',
    joined(addressesIn(storedTarget?.to ?? '')),
    joined(addressesIn(storedTarget?.cc ?? '')),
    joined(addressesIn(storedTarget?.bcc ?? '')),
    storedTarget?.subject ?? '',
    stored?.text ?? '',
  ]);
  const [seen, setSeen] = useState(storedFields);
  if (storedFields !== seen) {
    setSeen(storedFields);
    if (JSON.stringify([picked, joined(to), joined(cc), joined(bcc), subject, text]) === seen) {
      // A mailbox gone meanwhile: `from` falls back to the list's, as for a kept draft.
      setPicked(storedTarget?.accountId ?? '');
      setToState(addressesIn(storedTarget?.to ?? ''));
      setCcState(addressesIn(storedTarget?.cc ?? ''));
      setBccState(addressesIn(storedTarget?.bcc ?? ''));
      if (storedTarget?.cc || storedTarget?.bcc) setCopies(true);
      setSubject(storedTarget?.subject ?? '');
      setText(stored?.text ?? '');
    }
  }

  // The caret where one starts: to whom, else the words.
  const ready = accounts !== undefined && accounts.length > 0;
  useEffect(() => {
    if (!ready) return;
    (latest.current.to.length > 0 ? textRef.current : toRef.current)?.focus({
      preventScroll: true,
    });
  }, [ready]);

  // Esc closes it, back to the list (in a field it lets go of the field first).
  const closeHref = `${ui.mailPath}${search}`;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isTextTarget(event.target)) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      event.preventDefault();
      void navigate(closeHref);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, closeHref]);

  const submit = () => {
    if (!from) return;
    const addresses = latest.current;
    const refused = mailRefusal(addresses, text);
    setRefusal(refused);
    if (refused) {
      (refused.field === 'to' ? toRef : textRef).current?.focus();
      return;
    }
    const delay = look.delay;
    const mail = {
      accountId: from.id,
      ...addresses,
      subject: subject.trim(),
      text,
      delay,
      ...(forward ? { forward } : {}),
      uploads,
    };
    const fields = {
      accountId: picked,
      to: joined(addresses.to),
      cc: joined(addresses.cc),
      bcc: joined(addresses.bcc),
      subject,
    };
    // Back in the form, if one is still at the list it closed to.
    const reopen = () => {
      if (window.location.pathname === ui.mailPath)
        void navigate(`${ui.mailThreadPath(NEW_MAIL)}${search}`);
    };
    dropDraft(key);
    if (delay === 0) ui.notify('Mail gesendet');
    void navigate(closeHref);
    send.mutateAsync(mail).then(
      ({ threadId, message }) => {
        if (message.outbox?.state !== 'queued') return;
        // In the outbox: taken back from the toast, it comes back into the form as it was.
        ui.notify(
          `Im Postausgang – geht ${whenItGoes(message.outbox.at, Date.now())} raus`,
          'neutral',
          {
            label: 'Rückgängig',
            run: () =>
              takeBack.mutate(
                { threadId, messageId: message.id },
                {
                  onSuccess: (taken) => {
                    // Its files back as files put on it (passed-on ones too).
                    setDraft(
                      key,
                      taken.text,
                      targetOf(
                        {
                          accountId: fields.accountId,
                          to: joined(taken.to),
                          cc: joined(taken.cc),
                          bcc: joined(taken.bcc),
                          subject: taken.subject,
                        },
                        null,
                        taken.uploads,
                      ),
                    );
                    reopen();
                  },
                  onError: (error) => ui.notify(error.message, 'danger'),
                },
              ),
          },
        );
      },
      // Refused by the server or the mailbox's: back as it was.
      (error: Error) => {
        setDraft(key, text, targetOf(fields, forward, uploads));
        ui.notify(`Nicht gesendet: ${error.message}`, 'danger');
        reopen();
      },
    );
  };

  const onFieldKey = (event: KeyboardEvent<HTMLElement>) => {
    if (isModEnter(event)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const header = (
    <header className={PAGE_HEADER}>
      <MenuButton />
      <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
        <Icon name="edit" size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className={MAIL_SUBJECT}>{subject.trim() || 'Neue Mail'}</h1>
      </div>
      {pane && (
        <IconButton
          icon={pane.expanded ? 'closeFullscreen' : 'openInFull'}
          label={pane.expanded ? 'Verkleinern' : 'Vergrößern'}
          size="sm"
          active={pane.expanded}
          onClick={() => pane.setExpanded(!pane.expanded)}
        />
      )}
      <IconButton
        icon="close"
        label="Schließen"
        title="Schließen (Esc)"
        size="sm"
        onClick={() => void navigate(closeHref)}
      />
    </header>
  );

  if (accounts === undefined) return <section aria-label="Neue Mail">{header}</section>;
  if (accounts.length === 0 || !from) {
    return (
      <section aria-label="Neue Mail" className="flex min-h-0 flex-1 flex-col gap-3">
        {header}
        <div className="m-auto">
          <EmptyState
            title="Kein Postfach"
            message="Verbinde ein Postfach, dann schreibst du hier Mails – von deiner Adresse aus."
            action={
              <ButtonLink to={ui.newMailboxPath} variant="secondary" icon="add">
                Neues Postfach
              </ButtonLink>
            }
          />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Neue Mail"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(false);
        files.add([...event.dataTransfer.files]);
      }}
      className="relative flex min-h-0 flex-1 flex-col gap-3"
    >
      {header}
      {dropping && (
        <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0 z-20 flex items-center justify-center rounded-panel border-2 border-dashed border-primary bg-surface/80 text-body font-semibold text-fg">
          <span className="flex items-center gap-2">
            <Icon name="attachFile" size={18} />
            Zum Anhängen loslassen
          </span>
        </div>
      )}
      <form
        aria-label="Neue Mail"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel"
      >
        <Row label="Von" htmlFor={ids.from}>
          {accounts.length > 1 ? (
            <Select
              id={ids.from}
              value={from.id}
              onChange={(id) => {
                setPicked(id);
                keep({ accountId: id });
              }}
              options={accounts.map((account) => ({
                value: account.id,
                label: `${view.labels.get(account.id) ?? account.address} | ${account.address}`,
              }))}
              size="sm"
              className="max-w-full"
              onKeyDown={onFieldKey}
            />
          ) : (
            <output id={ids.from} className="truncate text-body text-fg-muted">
              {from.address}
            </output>
          )}
        </Row>
        <Row label="An" htmlFor={ids.to}>
          <AddressField
            inputRef={toRef}
            id={ids.to}
            book={book}
            label="An"
            placeholder="name@firma.de, …"
            invalid={refusal?.field === 'to'}
            describedBy={refusal?.field === 'to' ? ids.error : undefined}
            value={to}
            onChange={(addresses) => setAddresses('to', addresses)}
            onKeyDown={onFieldKey}
          />
          {!copies && (
            <button
              type="button"
              onClick={() => setCopies(true)}
              className="mt-2 shrink-0 self-start rounded-chip px-1.5 py-1 text-body text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              Cc/Bcc
            </button>
          )}
        </Row>
        {copies && (
          <>
            <Row label="Cc" htmlFor={ids.cc}>
              <AddressField
                id={ids.cc}
                book={book}
                label="Cc"
                value={cc}
                onChange={(addresses) => setAddresses('cc', addresses)}
                onKeyDown={onFieldKey}
              />
            </Row>
            <Row label="Bcc" htmlFor={ids.bcc}>
              <AddressField
                id={ids.bcc}
                book={book}
                label="Bcc"
                value={bcc}
                onChange={(addresses) => setAddresses('bcc', addresses)}
                onKeyDown={onFieldKey}
              />
            </Row>
          </>
        )}
        <Row label="Betreff" htmlFor={ids.subject}>
          <input
            id={ids.subject}
            type="text"
            value={subject}
            maxLength={500}
            onChange={(event) => {
              setSubject(event.target.value);
              keep({ subject: event.target.value });
            }}
            onKeyDown={onFieldKey}
            className={FIELD}
          />
        </Row>
        {((forward && forwarded && forwarded.attachments.length > 0) ||
          uploads.length + files.pending.length > 0) && (
          <div className="flex min-h-11 items-center gap-3 border-b border-hairline px-4 py-1.5">
            <span className="w-14 shrink-0 text-body text-fg-subtle">Anhänge</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {forward && forwarded && forwarded.attachments.length > 0 && (
                <span className="inline-flex max-w-full min-w-0 items-center gap-1">
                  {forwarded.attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-chip bg-surface-2 px-2 text-body text-fg"
                    >
                      <Icon name="forward" size={14} className="shrink-0 text-fg-subtle" />
                      <span className="truncate">{attachment.name}</span>
                    </span>
                  ))}
                  <IconButton
                    icon="close"
                    label="Ohne weitergeleitete Anhänge senden"
                    size="xs"
                    onClick={() => {
                      setForward(null);
                      keep({}, null);
                    }}
                  />
                </span>
              )}
              <MailUploads uploads={uploads} pending={files.pending} onRemove={files.remove} />
            </div>
          </div>
        )}
        <div
          className="flex min-h-0 flex-1 cursor-text flex-col overflow-y-auto px-4 py-3"
          // The words' field ends where they do (the signature under them): below, it takes the caret.
          onClick={(event) => {
            if (event.target === event.currentTarget) textRef.current?.focus();
          }}
        >
          <AutosizeTextarea
            ref={textRef}
            aria-label="Text"
            aria-invalid={refusal?.field === 'text' || undefined}
            aria-describedby={refusal?.field === 'text' ? ids.error : undefined}
            maxLength={MAX_MAIL_TEXT}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (refusal?.field === 'text') setRefusal(null);
              keep({ text: event.target.value });
            }}
            onKeyDown={onFieldKey}
            onPaste={(event) => {
              const pasted = [...event.clipboardData.files];
              if (pasted.length === 0) return;
              event.preventDefault();
              files.add(pasted);
            }}
            className="min-h-40 w-full resize-none bg-transparent text-body leading-[1.5] text-fg outline-none placeholder:text-fg-subtle"
          />
          {from?.signature && (
            // Added on sending (`withSignature`) – shown where it will stand, not typed into.
            <p
              aria-label="Signatur"
              className="pt-3 text-body leading-[1.5] whitespace-pre-wrap text-fg-subtle select-none"
            >
              {from.signature}
            </p>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-hairline px-4 py-2.5">
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = '';
              if (picked.length > 0) files.add(picked);
            }}
          />
          <IconButton
            icon="attachFile"
            label="Datei anhängen"
            size="sm"
            className="mr-auto"
            onClick={() => pickerRef.current?.click()}
          />
          {refusal && (
            <p id={ids.error} role="alert" className="min-w-0 text-caption text-danger">
              {refusal.text}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            icon="send"
            title={`Senden (${isApplePlatform() ? '⌘↵' : 'Strg+Enter'})`}
            className={cn('group')}
          >
            Senden
            <Kbd className="-mr-1 hidden text-on-primary/55 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-on-primary)_15%,transparent)] group-hover:inline-flex max-sm:hidden max-sm:group-hover:hidden">
              {isApplePlatform() ? '⌘' : 'Strg'}
              <ReturnKey />
            </Kbd>
          </Button>
        </footer>
      </form>
    </section>
  );
}
